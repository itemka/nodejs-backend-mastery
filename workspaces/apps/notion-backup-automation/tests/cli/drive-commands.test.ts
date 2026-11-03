import { describe, expect, it } from 'vitest';

import { GoogleRefreshTokenStore } from '../../src/adapters/google/refresh-token-store.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../src/adapters/persistence/redis-secret-store.js';
import { main } from '../../src/cli/main.js';
import { createEnvelopeKey } from '../../src/shared/envelope-crypto.js';
import { testCli } from '../support/cli-context.js';
import {
  refreshWebTokenOnly,
  WEB_CLIENT_ID,
  WEB_CLIENT_SECRET,
  WEB_REFRESH_TOKEN,
} from '../support/fake-google-identity.js';
import {
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  GMAIL_SCOPE,
  googleError,
} from '../support/fake-google.js';
import { ManualClock } from '../support/manual-clock.js';

const FILES = 'www.googleapis.com/drive/v3/files';
const env = {
  GOOGLE_CLIENT_ID: fakeCredentials.clientId,
  GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
  GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: 'root-folder-id',
  GOOGLE_REFRESH_TOKEN: fakeCredentials.refreshToken,
};

interface DriveState {
  rootVisible: boolean;
  subfolders: string[];
  writableParents: string[];
}

function fakeDrive({ rootVisible, subfolders, writableParents }: DriveState) {
  return new FakeGoogle()
    .onRefresh()
    .on('GET', `${FILES}/root-folder-id`, () =>
      rootVisible
        ? Response.json({
            id: 'root-folder-id',
            mimeType: 'application/vnd.google-apps.folder',
            name: 'Full Workspace',
          })
        : googleError(404, 'notFound'),
    )
    .on('GET', FILES, () =>
      Response.json({ files: subfolders.map((name) => ({ id: `id-${name}`, name })) }),
    )
    .on('POST', FILES, ({ body }) => {
      const { parents = [] } = JSON.parse(body) as { parents?: string[] };

      return parents.every((parent) => writableParents.includes(parent))
        ? Response.json({ id: 'probe-id' })
        : googleError(404, 'notFound');
    })
    .on('DELETE', `${FILES}/probe-id`, () => new Response(null, { status: 204 }));
}

describe('drive:check', () => {
  it('passes in "existing" mode when every check passes', async () => {
    const google = fakeDrive({
      rootVisible: true,
      subfolders: ['2026'],
      writableParents: ['root-folder-id', 'id-2026'],
    });
    const { context, text } = await testCli({ env, fetch: google.fetch });

    await expect(main(['drive:check'], context)).resolves.toBe(0);
    expect(text()).toContain('Drive access check (S6), year folder 2026');
    expect(text()).toContain(
      'All checks pass: use the existing root and year folder (mode "existing").',
    );
  });

  it('passes with a warning when only the root works', async () => {
    const google = fakeDrive({
      rootVisible: true,
      subfolders: [],
      writableParents: ['root-folder-id'],
    });
    const { context, text } = await testCli({ env, fetch: google.fetch });

    await expect(main(['drive:check'], context)).resolves.toBe(0);
    expect(text()).toContain('The root works, but your 2026 folder does not.');
    expect(text()).toContain('pick "2026" with auth:google --pick-folders');
  });

  it('fails and points to the Picker grant when the app cannot use the root', async () => {
    const google = fakeDrive({ rootVisible: false, subfolders: [], writableParents: [] });
    const { context, text } = await testCli({ env, fetch: google.fetch });

    await expect(main(['drive:check'], context)).resolves.toBe(1);
    expect(text()).toContain('✗ C1  root not visible: HTTP 404 (notFound)');
    expect(text()).toContain('- C4  skipped: no single 2026 folder is visible');
    expect(text()).toContain('Fallback 1: run auth:google --pick-folders');
  });

  it('picks the year in the backup time zone, or the one given', async () => {
    const google = fakeDrive({ rootVisible: true, subfolders: [], writableParents: [] });
    // 23:30 UTC on 31 December is already 1 January in Warsaw.
    const clock = new ManualClock('2026-12-31T23:30:00.000Z');
    const { context, text } = await testCli({ clock, env, fetch: google.fetch });

    await main(['drive:check'], context);
    await main(['drive:check', '--year', '2030'], context);

    expect(text()).toContain('year folder 2027');
    expect(text()).toContain('year folder 2030');
  });

  it('checks with the token a phone re-login stored, once Redis is set, with no GOOGLE_REFRESH_TOKEN (reviews, 2026-11-02 and 11-03)', async () => {
    const encryptionKey = Buffer.alloc(32, 7).toString('base64');
    const google = refreshWebTokenOnly(
      fakeDrive({
        rootVisible: true,
        subfolders: ['2026'],
        writableParents: ['root-folder-id', 'id-2026'],
      }),
    );
    const { GOOGLE_REFRESH_TOKEN: _token, ...withoutToken } = env;
    const { context, redis, text } = await testCli({
      env: {
        ...withoutToken,
        APP_ENCRYPTION_KEY: encryptionKey,
        APP_ENV: 'prod',
        GOOGLE_WEB_CLIENT_ID: WEB_CLIENT_ID,
        GOOGLE_WEB_CLIENT_SECRET: WEB_CLIENT_SECRET,
        UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
        UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
      },
      fetch: google.fetch,
    });

    await new GoogleRefreshTokenStore(
      new RedisSecretStore({
        appEnv: 'prod',
        key: createEnvelopeKey(encryptionKey),
        keyPrefix: keyPrefixFor('prod'),
        redis,
      }),
    ).save({ client: 'web', refreshToken: WEB_REFRESH_TOKEN, scopes: [GMAIL_SCOPE, DRIVE_SCOPE] });

    await expect(main(['drive:check'], context)).resolves.toBe(0);
    expect(text()).toContain('All checks pass');
  });

  it('reports GOOGLE_AUTH_REQUIRED with its fix', async () => {
    const google = new FakeGoogle().onToken(() =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    const { context, text } = await testCli({ env, fetch: google.fetch });

    await expect(main(['drive:check'], context)).resolves.toBe(1);
    expect(text()).toContain(
      '✗ GOOGLE_AUTH_REQUIRED: Google rejected the refresh token (invalid_grant)',
    );
    expect(text()).toContain('Fix: Sign in with Google again');
  });
});

describe('drive:init', () => {
  it('creates the app-owned root and prints its ID and the manual steps', async () => {
    const google = new FakeGoogle()
      .onRefresh()
      .on('GET', FILES, () => Response.json({ files: [] }))
      .on('POST', FILES, () => Response.json({ id: 'new-root-id' }));
    const { context, text } = await testCli({ env, fetch: google.fetch });

    await expect(main(['drive:init'], context)).resolves.toBe(0);
    expect(text()).toContain('Created the app-owned "Full Workspace" folder');
    expect(text()).toContain('folder ID  new-root-id');
    expect(text()).toContain('Set GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID to this ID');
  });
});
