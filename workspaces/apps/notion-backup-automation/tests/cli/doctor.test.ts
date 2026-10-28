import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../src/adapters/persistence/redis-secret-store.js';
import { main } from '../../src/cli/main.js';
import type { EnvelopeMeta } from '../../src/shared/envelope-crypto.js';
import { createEnvelopeKey } from '../../src/shared/envelope-crypto.js';
import { testCli } from '../support/cli-context.js';
import {
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  GMAIL_SCOPE,
  googleError,
} from '../support/fake-google.js';
import { FAKE_HUB_URL, fakeHubToken, telegramError } from '../support/fake-telegram.js';
import { loadEmailFixture, toGmailMessage, withHeader } from '../support/gmail-fixtures.js';
import { ManualClock } from '../support/manual-clock.js';

const MESSAGES = 'gmail.googleapis.com/gmail/v1/users/me/messages';
const exportReady = withHeader(loadEmailFixture('export-ready'), 'To', 'artsem@example.com');
const encryptionKey = randomBytes(32).toString('base64');

const fullEnv = {
  APP_ENCRYPTION_KEY: encryptionKey,
  APP_ENV: 'dev',
  GOOGLE_CLIENT_ID: fakeCredentials.clientId,
  GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
  GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: 'root-folder-id',
  GOOGLE_REFRESH_TOKEN: fakeCredentials.refreshToken,
  TELEGRAM_HUB_TOKEN: fakeHubToken,
  TELEGRAM_HUB_URL: FAKE_HUB_URL,
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
  UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
};

/** The hub answers an authenticated GET with 405; doctor never calls its public health route. */
const HUB_MESSAGES = 'hub.example/api/messages';

function healthyGoogle() {
  return new FakeGoogle()
    .onRefresh(`${GMAIL_SCOPE} ${DRIVE_SCOPE}`)
    .on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () =>
      Response.json({ emailAddress: 'artsem@example.com' }),
    )
    .on('GET', MESSAGES, () => Response.json({ messages: [{ id: exportReady.id }] }))
    .on('GET', `${MESSAGES}/*`, () => Response.json(toGmailMessage(exportReady)))
    .on('GET', 'www.googleapis.com/drive/v3/files/root-folder-id', () =>
      Response.json({
        capabilities: { canAddChildren: false },
        id: 'root-folder-id',
        mimeType: 'application/vnd.google-apps.folder',
        name: 'Full Workspace',
      }),
    )
    .on(
      'GET',
      HUB_MESSAGES,
      () => new Response(undefined, { headers: { allow: 'POST' }, status: 405 }),
    );
}

async function setup(google = healthyGoogle(), env: Record<string, string> = fullEnv) {
  return testCli({ clock: new ManualClock('2026-10-18T10:00:00.000Z'), env, fetch: google.fetch });
}

async function storeSession(cli: Awaited<ReturnType<typeof setup>>, meta: EnvelopeMeta = {}) {
  const store = new RedisSecretStore({
    appEnv: 'dev',
    clock: new ManualClock('2026-10-08T10:00:00.000Z'),
    key: createEnvelopeKey(encryptionKey),
    keyPrefix: keyPrefixFor('dev'),
    redis: cli.redis,
  });

  await store.put(
    'notion-storage-state',
    '{"cookies":[{"name":"token_v2","value":"secret"}]}',
    meta,
  );
}

describe('doctor', () => {
  it('reports every dependency as healthy, with masked or content-free details', async () => {
    const cli = await setup();

    await storeSession(cli);

    await expect(main(['doctor'], cli.context)).resolves.toBe(0);

    expect(cli.output.slice(1)).toEqual([
      '✓ google          token refreshed, scopes gmail.readonly, drive.file',
      '✓ gmail           mailbox a***@example.com',
      `✓ export email    ${exportReady.id}, received 2026-10-01T20:56:22.000Z; trusted, one allowed link`,
      '✓ drive root      root visible: "Full Workspace", canAddChildren no',
      '✓ redis           reachable, APP_ENV dev',
      '✓ notion session  stored 2026-10-08T10:00:00.000Z (10 days ago), opens with APP_ENCRYPTION_KEY',
      '✓ telegram        hub accepts TELEGRAM_HUB_TOKEN; buttons use the nb-dev namespace',
    ]);
  });

  it('shows the sign-in cookie expiry that auth:notion recorded', async () => {
    const cli = await setup();

    await storeSession(cli, { authCookieExpiresAt: '2027-10-08T10:00:00.000Z' });

    await expect(main(['doctor'], cli.context)).resolves.toBe(0);
    expect(cli.output).toContain(
      '✓ notion session  stored 2026-10-08T10:00:00.000Z (10 days ago), opens with APP_ENCRYPTION_KEY; sign-in until 2027-10-08T10:00:00.000Z',
    );
  });

  it('treats Telegram as optional: unset, the notifications go to the console only', async () => {
    const { TELEGRAM_HUB_TOKEN: _token, TELEGRAM_HUB_URL: _chat, ...withoutTelegram } = fullEnv;
    const cli = await setup(healthyGoogle(), withoutTelegram);

    await storeSession(cli);

    await expect(main(['doctor'], cli.context)).resolves.toBe(0);
    expect(cli.output.at(-1)).toBe(
      '- telegram        not configured; notifications go to the console only',
    );
  });

  it('names the missing variable when only the hub URL is missing', async () => {
    const { TELEGRAM_HUB_URL: _chat, ...withoutChat } = fullEnv;
    const cli = await setup(healthyGoogle(), withoutChat);

    await storeSession(cli);

    await expect(main(['doctor'], cli.context)).resolves.toBe(0);
    expect(cli.output.at(-1)).toBe(
      '! telegram        TELEGRAM_HUB_URL missing; notifications go to the console only',
    );
  });

  it('fails the Telegram check when the hub refuses the token, without printing it', async () => {
    const google = healthyGoogle().on('GET', HUB_MESSAGES, () =>
      telegramError(401, 'Unauthorized'),
    );
    const cli = await setup(google);

    await storeSession(cli);

    await expect(main(['doctor'], cli.context)).resolves.toBe(1);
    expect(cli.output.at(-1)).toBe(
      '✗ telegram        the hub refuses TELEGRAM_HUB_TOKEN: it must equal this route’s token in HUB_INTEGRATIONS',
    );
    expect(cli.text()).not.toContain(fakeHubToken);
  });

  it('fails the Telegram check when the hub is unavailable', async () => {
    const google = healthyGoogle().on('GET', HUB_MESSAGES, () => telegramError(503, 'Unavailable'));
    const cli = await setup(google);

    await storeSession(cli);

    await expect(main(['doctor'], cli.context)).resolves.toBe(1);
    expect(cli.output.at(-1)).toBe(
      '✗ telegram        hub_503: Telegram hub token check failed (HTTP 503)',
    );
  });

  it('names a malformed hub token without printing it', async () => {
    const cli = await setup(healthyGoogle(), { ...fullEnv, TELEGRAM_HUB_TOKEN: 'short' });

    await expect(main(['doctor'], cli.context)).resolves.toBe(1);
    expect(cli.output.at(-1)).toBe(
      '✗ telegram        Configuration incomplete: invalid TELEGRAM_HUB_TOKEN in .env.local',
    );
    expect(cli.text()).not.toContain('not-a-bot-token');
  });

  it('searches from the start of --email-since in the backup time zone', async () => {
    const google = healthyGoogle();
    const cli = await setup(google);

    await main(['doctor', '--email-since', '2026-10-01'], cli.context);

    const search = google
      .requestsTo(MESSAGES)
      .find((request) => request.url.pathname.endsWith('/messages'));

    // Midnight in Warsaw (CEST) is 22:00 UTC the day before; the search starts 10 minutes earlier.
    expect(search?.url.searchParams.get('q')).toContain(
      `after:${Date.parse('2026-09-30T22:00:00Z') / 1000 - 600}`,
    );
  });

  it('finds an email received before UTC midnight on the local day (2026-10-18 regression)', async () => {
    const lateEvening = {
      ...exportReady,
      internalDate: String(Date.parse('2026-10-17T23:48:19Z')),
    };
    const google = healthyGoogle().on('GET', `${MESSAGES}/*`, () =>
      Response.json(toGmailMessage(lateEvening)),
    );
    const cli = await setup(google);

    await main(['doctor', '--email-since', '2026-10-18'], cli.context);

    expect(cli.text()).toContain(
      `✓ export email    ${exportReady.id}, received 2026-10-17T23:48:19.000Z; trusted, one allowed link`,
    );
  });

  it('never prints or logs a token, the link, the subject, the body or the mailbox', async () => {
    const cli = await setup();

    await storeSession(cli);
    await main(['doctor'], cli.context);

    const everything = [...cli.output, ...cli.logs].join('\n');

    for (const secret of [
      fakeCredentials.refreshToken,
      fakeCredentials.accessToken,
      fakeCredentials.clientSecret,
      'artsem@example.com',
      'mg.mail.notion.com',
      'Your workspace export is ready',
      'download the export',
      'token_v2',
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('names the fix for an expired Testing token and skips the Gmail checks', async () => {
    const google = healthyGoogle().onToken(() =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    const cli = await setup(google);

    await expect(main(['doctor'], cli.context)).resolves.toBe(1);

    expect(cli.text()).toContain(
      '✗ google          GOOGLE_AUTH_REQUIRED: Google rejected the refresh token (invalid_grant). A Testing token expires after 7 days: run auth:google',
    );
    expect(cli.text()).toContain('- gmail           needs a working Google token');
  });

  it('warns when no trusted export email arrived, with the rejection counts', async () => {
    const forged = withHeader(
      loadEmailFixture('forged-authentication-results'),
      'To',
      'artsem@example.com',
    );
    const google = healthyGoogle()
      .on('GET', MESSAGES, () => Response.json({ messages: [{ id: forged.id }] }))
      .on('GET', `${MESSAGES}/*`, () => Response.json(toGmailMessage(forged)));
    const cli = await setup(google);

    await storeSession(cli);

    await expect(main(['doctor', '--email-since', '2026-10-01'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain(
      '! export email    none trusted since 2026-10-01 (rejected: authentication 1)',
    );
  });

  it('says so when the mailbox holds no email from Notion at all', async () => {
    const google = healthyGoogle().on('GET', MESSAGES, () =>
      Response.json({ resultSizeEstimate: 0 }),
    );
    const cli = await setup(google);

    await main(['doctor', '--email-since', '2026-09-30'], cli.context);

    expect(cli.text()).toContain(
      '! export email    no email from notify@mail.notion.com in this mailbox since 2026-09-30',
    );
  });

  it('warns when the Notion session is not stored yet', async () => {
    const cli = await setup();

    await expect(main(['doctor'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('! notion session  not stored for APP_ENV dev; run auth:notion');
  });

  it('fails the Drive check when the root is not visible', async () => {
    const google = healthyGoogle().on(
      'GET',
      'www.googleapis.com/drive/v3/files/root-folder-id',
      () => googleError(404, 'notFound'),
    );
    const cli = await setup(google);

    await expect(main(['doctor'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain(
      '✗ drive root      root not visible: HTTP 404 (notFound); run drive:check',
    );
  });

  it('names the missing variables of each check', async () => {
    const cli = await setup(healthyGoogle(), {});

    await expect(main(['doctor'], cli.context)).resolves.toBe(1);

    expect(cli.text()).toContain(
      'google          Configuration incomplete: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in .env.local',
    );
    expect(cli.text()).toContain(
      'drive root      Configuration incomplete: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID, GOOGLE_REFRESH_TOKEN',
    );
    expect(cli.text()).toContain(
      'redis           Configuration incomplete: missing APP_ENV, UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL',
    );
  });
});
