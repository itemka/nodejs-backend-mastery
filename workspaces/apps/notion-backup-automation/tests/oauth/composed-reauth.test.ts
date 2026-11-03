import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { GoogleRefreshTokenStore } from '../../src/adapters/google/refresh-token-store.js';
import { createWebOAuthClient } from '../../src/adapters/google/web-consent.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../src/adapters/persistence/redis-secret-store.js';
import { GoogleRelogin } from '../../src/application/google-relogin.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import { ProbeRunner } from '../../src/application/probe-runner.js';
import { createGoogleServices } from '../../src/config/google-containers.js';
import { handleOAuthRequest } from '../../src/http/oauth-handler.js';
import type { OAuthDeps } from '../../src/oauth/deps.js';
import { createEnvelopeKey } from '../../src/shared/envelope-crypto.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { FakeDrive, FOLDER_MIME_TYPE, ROOT_ID } from '../support/fake-drive.js';
import {
  OWNER_EMAIL,
  serveGoogleSignIn,
  WEB_CLIENT_ID,
  WEB_CLIENT_SECRET,
  WEB_REFRESH_TOKEN,
} from '../support/fake-google-identity.js';
import { fakeCredentials } from '../support/fake-google.js';
import { FakeRedis } from '../support/fake-redis.js';
import { BASE, location, oauthHarness } from '../support/oauth.js';

const SECRET_KEY = '{nba:test}:secret:google-refresh-token';

/**
 * The re-login callback on the production pieces: the encrypted envelope, the token provider and
 * probes that `createGoogleServices` builds for the worker, the cron and `/oauth`, the probe
 * runner, and the resume of a job waiting for Google. Only Google, Redis and QStash are fakes.
 */
async function setup() {
  const backup = backupHarness();

  backup.trigger.script = [new IntegrationError('GOOGLE_AUTH_REQUIRED')];
  await backup.service.start();
  await backup.drain();

  const drive = new FakeDrive();

  drive.add({ mimeType: FOLDER_MIME_TYPE, name: '2026' });
  serveGoogleSignIn(drive.google, { refreshToken: WEB_REFRESH_TOKEN });
  drive.google.on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () =>
    Response.json({ emailAddress: OWNER_EMAIL }),
  );

  const redis = new FakeRedis();
  const secrets = new RedisSecretStore({
    appEnv: 'test',
    clock: backup.clock,
    key: createEnvelopeKey(Buffer.alloc(32, 7).toString('base64')),
    keyPrefix: keyPrefixFor('test'),
    redis,
  });
  const google = createGoogleServices(
    {
      GOOGLE_CLIENT_ID: fakeCredentials.clientId,
      GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
      GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: ROOT_ID,
      GOOGLE_WEB_CLIENT_ID: WEB_CLIENT_ID,
      GOOGLE_WEB_CLIENT_SECRET: WEB_CLIENT_SECRET,
    },
    { devFolder: false, fetch: drive.fetch, logger: backup.logger, secrets, writeSidecar: true },
  );
  const { deps: base } = oauthHarness();
  const deps: OAuthDeps = {
    ...base,
    google: {
      ...base.google,
      client: () =>
        createWebOAuthClient({
          appBaseUrl: BASE,
          clientId: WEB_CLIENT_ID,
          clientSecret: WEB_CLIENT_SECRET,
          fetch: drive.fetch,
          retries: 0,
        }),
    },
    renewal: {
      relogin: new GoogleRelogin({
        jobs: backup.jobs,
        logger: backup.logger,
        notifications: backup.notifications,
        probes: new ProbeRunner({
          clock: backup.clock,
          health: backup.health,
          logger: backup.logger,
          probes: google.probes,
          timeZone: 'Europe/Warsaw',
        }),
        service: backup.service,
      }),
      tokens: new GoogleRefreshTokenStore(secrets),
    },
  };
  const serve = (request: Request) =>
    handleOAuthRequest(request, { logger: backup.logger, relogin: () => deps });

  return { backup, drive, redis, serve };
}

describe('the phone re-login, composed', () => {
  it('stores the Web token encrypted, refreshes with it, probes, and resumes the waiting job', async () => {
    const { backup, drive, redis, serve } = await setup();
    const toGoogle = location(await serve(new Request(`${BASE}/oauth/google/reauth`)));
    const callback = new URL(`${BASE}/oauth/google/callback`);

    callback.searchParams.set('state', toGoogle.searchParams.get('state') ?? '');
    callback.searchParams.set('code', 'google-code');

    const page = await serve(new Request(callback));

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('job 2026-10 resumed');

    // Sealed in Redis: the token never appears, its client does.
    const envelope = redis.strings.get(SECRET_KEY) ?? '';

    expect(envelope).not.toContain(WEB_REFRESH_TOKEN);
    expect(JSON.parse(envelope)).toMatchObject({ meta: { client: 'web' } });

    // The code exchange carried the verifier of the challenge the sign-in started with (PKCE
    // S256), so a verifier mixed up between sign-ins would fail here (Codex review, 2026-11-03).
    const tokenForms = drive.google
      .requestsTo('oauth2.googleapis.com/token')
      .map((request) => new URLSearchParams(request.body));
    const exchanges = tokenForms.filter((form) => form.get('grant_type') === 'authorization_code');
    const verifier = exchanges[0]?.get('code_verifier') ?? '';

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.get('code')).toBe('google-code');
    expect(toGoogle.searchParams.get('code_challenge_method')).toBe('S256');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      toGoogle.searchParams.get('code_challenge'),
    );
    expect(toGoogle.toString()).not.toContain(verifier);

    // The probes refreshed with that token and the Web client, then reached Gmail and Drive.
    const refreshes = tokenForms.filter((form) => form.get('grant_type') === 'refresh_token');

    expect(refreshes.length).toBeGreaterThan(0);
    expect(refreshes.every((form) => form.get('refresh_token') === WEB_REFRESH_TOKEN)).toBe(true);
    expect(refreshes.every((form) => form.get('client_id') === WEB_CLIENT_ID)).toBe(true);
    expect(drive.google.requestsTo('gmail.googleapis.com/gmail/v1/users/me/profile')).toHaveLength(
      1,
    );
    expect(drive.google.requestsTo('www.googleapis.com/drive/v3/files/')).toContainEqual(
      expect.objectContaining({ method: 'DELETE' }),
    );

    // The job waiting for Google resumed, and the renewal was reported and recorded.
    await expect(storedJob(backup, '2026-10')).resolves.toMatchObject({
      status: 'TRIGGERING_EXPORT',
    });
    expect(backup.qstash.published.at(-1)).toMatchObject({ reason: 'retry' });
    expect(backup.sent.at(-1)).toMatchObject({
      kind: 'loginWarning',
      notification: { kind: 'renewed', service: 'google' },
    });
    await expect(backup.health.read()).resolves.toMatchObject({
      driveRoot: { mode: 'existing', ok: true },
      google: { tokenOk: true },
    });
  });

  it('keeps a saved, working token when the waiting job is busy (review, 2026-11-02)', async () => {
    const { backup, redis, serve } = await setup();

    await backup.jobs.acquireLease('2026-10', 'another-invocation', 60_000);

    const toGoogle = location(await serve(new Request(`${BASE}/oauth/google/reauth`)));
    const callback = new URL(`${BASE}/oauth/google/callback`);

    callback.searchParams.set('state', toGoogle.searchParams.get('state') ?? '');
    callback.searchParams.set('code', 'google-code');

    const page = await serve(new Request(callback));
    const text = await page.text();

    expect(page.status).toBe(200);
    expect(text).toContain('Google access renewed. Job 2026-10 was busy');
    expect(text).not.toContain('Nothing was');
    expect(JSON.parse(redis.strings.get(SECRET_KEY) ?? '{}')).toMatchObject({
      meta: { client: 'web' },
    });
    await expect(storedJob(backup, '2026-10')).resolves.toMatchObject({
      status: 'NEEDS_ATTENTION',
    });
    expect(backup.sent.at(-1)).toMatchObject({
      kind: 'loginWarning',
      notification: { kind: 'renewed', service: 'google' },
    });
  });
});
