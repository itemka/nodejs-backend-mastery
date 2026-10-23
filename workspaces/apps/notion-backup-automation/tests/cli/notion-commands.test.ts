import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { captureSession, NotionSessionStore } from '../../src/adapters/notion/notion-session.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../src/adapters/persistence/redis-secret-store.js';
import { main } from '../../src/cli/main.js';
import { createEnvelopeKey } from '../../src/shared/envelope-crypto.js';
import type { TestCli } from '../support/cli-context.js';
import { testCli } from '../support/cli-context.js';
import { fakeCredentials, FakeGoogle } from '../support/fake-google.js';
import { loadEmailFixture, toGmailMessage, withHeader } from '../support/gmail-fixtures.js';
import { ManualClock } from '../support/manual-clock.js';
import {
  accessDenied,
  FILE_HOST,
  fileUrl,
  MAILGUN_HOST,
  NotionHosts,
  redirectTo,
  serveBytes,
} from '../support/notion-hosts.js';
import { zipFixture } from '../support/zip-fixtures.js';

/** The day after the fixture email arrived (2026-10-01T20:56:22Z). */
const NOW = new Date('2026-10-02T10:00:00.000Z');
const EXPIRES = new Date(NOW.getTime() + 6 * 86_400_000);
const MESSAGES = 'gmail.googleapis.com/gmail/v1/users/me/messages';
const exportReady = withHeader(loadEmailFixture('export-ready'), 'To', 'artsem@example.com');
const encryptionKey = randomBytes(32).toString('base64');

const notionEnv = {
  APP_ENCRYPTION_KEY: encryptionKey,
  APP_ENV: 'dev',
  NOTION_WORKSPACE_NAME: "Test User's Notion",
  NOTION_WORKSPACE_URL: 'https://app.notion.com/p/Dashboard-00000000000000000000000000000000',
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
  UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
};

const downloadEnv = {
  APP_ENCRYPTION_KEY: encryptionKey,
  APP_ENV: 'dev',
  GOOGLE_CLIENT_ID: fakeCredentials.clientId,
  GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
  GOOGLE_REFRESH_TOKEN: fakeCredentials.refreshToken,
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
  UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
};

const FILE_TOKEN = `file_token=${'f'.repeat(40)}`;

function cookie(name: string, domain: string, value: string) {
  return {
    domain,
    expires: NOW.getTime() / 1000 + 365 * 86_400,
    httpOnly: true,
    name,
    path: '/',
    sameSite: 'Lax',
    secure: true,
    value,
  };
}

/** Saves a dev session as `auth:notion` would, into the CLI's fake Redis. */
async function saveSession(
  cli: TestCli,
  cookies = [cookie('file_token', '.notion.com', 'f'.repeat(40))],
) {
  const captured = captureSession(
    { cookies: [cookie('token_v2', '.app.notion.com', 'v'.repeat(40)), ...cookies], origins: [] },
    {
      locale: 'en-US',
      timezoneId: 'Europe/Warsaw',
      userAgent: 'Mozilla/5.0 Chrome/141.0.0.0',
      viewport: { height: 900, width: 1440 },
    },
    NOW,
  );
  const secrets = new RedisSecretStore({
    appEnv: 'dev',
    clock: new ManualClock(NOW),
    key: createEnvelopeKey(encryptionKey),
    keyPrefix: keyPrefixFor('dev'),
    redis: cli.redis,
  });

  await new NotionSessionStore({ secrets }).save(captured);
}

function gmailWithExport(): FakeGoogle {
  return new FakeGoogle()
    .onRefresh()
    .on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () =>
      Response.json({ emailAddress: 'artsem@example.com' }),
    )
    .on('GET', MESSAGES, () => Response.json({ messages: [{ id: exportReady.id }] }))
    .on('GET', `${MESSAGES}/*`, () => Response.json(toGmailMessage(exportReady)));
}

/** Google requests go to the fake Google, Mailgun and the file host to the local server. */
async function downloadSetup(
  google = gmailWithExport(),
  env: Record<string, string> = downloadEnv,
) {
  const hosts = await NotionHosts.start();
  const notionHosts = new Set([MAILGUN_HOST, FILE_HOST]);

  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    return notionHosts.has(url.hostname) ? hosts.fetch(input, init) : google.fetch(input, init);
  };

  const cli = await testCli({ clock: new ManualClock(NOW), env, fetch });

  hosts.on(MAILGUN_HOST, redirectTo(fileUrl(EXPIRES)));

  return { cli, hosts };
}

/** `dev:download`'s temporary directories in this test's own temp directory. */
async function downloadDirectories(cli: TestCli): Promise<string[]> {
  const names = await readdir(cli.directory);

  return names.filter((name) => name.startsWith('nba-dev-download-'));
}

describe('auth:notion', () => {
  it('names the missing variables', async () => {
    const cli = await testCli({ env: { APP_ENV: 'dev' } });

    await expect(main(['auth:notion'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('missing APP_ENCRYPTION_KEY, NOTION_WORKSPACE_NAME');
  });

  it('reports a browser that does not start, and saves nothing', async () => {
    const cli = await testCli({ env: notionEnv });

    await expect(main(['auth:notion'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('BROWSER_LAUNCH_FAILED: No browser in tests');
    expect(cli.redis.strings.size).toBe(0);
  });
});

describe('dev:trigger', () => {
  it('runs with the dev session only', async () => {
    const cli = await testCli({ env: { ...notionEnv, APP_ENV: 'prod' } });

    await expect(main(['dev:trigger', '--dry-run'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('run it with APP_ENV=dev');
  });

  it('needs a saved session before it starts a browser', async () => {
    const cli = await testCli({ env: notionEnv });

    await expect(main(['dev:trigger'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('NOTION_SESSION_EXPIRED: No Notion session is saved');
    expect(cli.text()).toContain('Fix: Run auth:notion');
  });

  it('reports a browser that does not start', async () => {
    const cli = await testCli({ env: notionEnv });

    await saveSession(cli);

    await expect(main(['dev:trigger', '--dry-run'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('BROWSER_LAUNCH_FAILED');
  });
});

describe('dev:download', () => {
  it('downloads the newest export with the session cookies, checks it, and deletes it', async () => {
    const zip = await readFile(zipFixture('notion-export.zip'));
    const { cli, hosts } = await downloadSetup();
    let duringDownload: string[] = [];

    hosts.on(FILE_HOST, async (request, response) => {
      duringDownload = await downloadDirectories(cli);
      serveBytes(zip)(request, response);
    });
    await saveSession(cli);

    await expect(main(['dev:download'], cli.context)).resolves.toBe(0);

    expect(cli.output.slice(1)).toEqual([
      `  email          ${exportReady.id}, received 2026-10-01T20:56:22.000Z`,
      `  link expires   ${EXPIRES.toISOString()}`,
      '✓ Downloaded with the dev session, and the ZIP passed its checks.',
      String.raw`  starts with    PK\x03\x04`,
      `  size           ${zip.length} bytes`,
      '  SHA-256        76d5eeb0b01b42fcdff113a9681c54af7029a51099d1c8725a578fe2fbe2ad5b',
      '  files          4, 231150 bytes uncompressed',
      'The temporary copy is deleted; nothing was uploaded.',
    ]);
    expect(hosts.requestsTo(FILE_HOST).map((request) => request.cookie)).toEqual([FILE_TOKEN]);
    expect(hosts.requestsTo(MAILGUN_HOST).map((request) => request.cookie)).toEqual([undefined]);
    expect(duringDownload).toHaveLength(1);
    await expect(downloadDirectories(cli)).resolves.toEqual([]);
  });

  it('runs with the dev session only', async () => {
    const { cli, hosts } = await downloadSetup(gmailWithExport(), {
      ...downloadEnv,
      APP_ENV: 'prod',
    });

    await expect(main(['dev:download'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('run it with APP_ENV=dev');
    expect(hosts.requests).toEqual([]);
  });

  it('fails when no trusted export email arrived since --email-since', async () => {
    const google = gmailWithExport().on('GET', MESSAGES, () => Response.json({}));
    const { cli, hosts } = await downloadSetup(google);

    await expect(main(['dev:download', '--email-since', '2026-10-02'], cli.context)).resolves.toBe(
      1,
    );
    expect(cli.text()).toContain('No trusted export email since 2026-10-02.');
    expect(hosts.requests).toEqual([]);
  });

  it('stops before the file host when the link has expired', async () => {
    const { cli, hosts } = await downloadSetup();

    hosts.on(MAILGUN_HOST, redirectTo(fileUrl(new Date(NOW.getTime() - 1000))));
    await saveSession(cli);

    await expect(main(['dev:download'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('The link has expired; run dev:trigger for a new export.');
    expect(hosts.requestsTo(FILE_HOST)).toEqual([]);
  });

  it('needs a session cookie for the file host', async () => {
    const { cli, hosts } = await downloadSetup();

    await saveSession(cli, []);

    await expect(main(['dev:download'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain(
      "NOTION_SESSION_EXPIRED: The saved Notion session has no unexpired cookie for Notion's file host",
    );
    expect(hosts.requestsTo(FILE_HOST)).toEqual([]);
  });

  it("reports the file host's refusal before the expiry as NOTION_SESSION_EXPIRED", async () => {
    const { cli, hosts } = await downloadSetup();

    hosts.on(FILE_HOST, accessDenied);
    await saveSession(cli);

    await expect(main(['dev:download'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('NOTION_SESSION_EXPIRED');
    await expect(downloadDirectories(cli)).resolves.toEqual([]);
  });
});
