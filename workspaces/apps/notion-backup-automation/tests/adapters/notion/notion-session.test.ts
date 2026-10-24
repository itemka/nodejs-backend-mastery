import { describe, expect, it } from 'vitest';

import type { BrowserFingerprint } from '../../../src/adapters/notion/notion-session.js';
import {
  captureSession,
  isNotionHost,
  NotionSessionStore,
  sessionMeta,
} from '../../../src/adapters/notion/notion-session.js';
import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../../src/adapters/persistence/redis-secret-store.js';
import {
  cookieHeaderFor,
  parseSessionCookies,
} from '../../../src/adapters/transfer/download-cookies.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import type { SecretStore } from '../../../src/application/ports.js';
import { createEnvelopeKey } from '../../../src/shared/envelope-crypto.js';
import { FakeRedis } from '../../support/fake-redis.js';
import { ManualClock } from '../../support/manual-clock.js';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const IN_A_YEAR = NOW.getTime() / 1000 + 365 * 86_400;
const IN_A_MONTH = NOW.getTime() / 1000 + 30 * 86_400;

const FINGERPRINT: BrowserFingerprint = {
  locale: 'en-US',
  timezoneId: 'Europe/Warsaw',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  viewport: { height: 900, width: 1440 },
};

function cookie(name: string, domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    expires: IN_A_YEAR,
    httpOnly: true,
    name,
    path: '/',
    sameSite: 'Lax',
    secure: true,
    value: `${name}-value-that-must-stay-secret`,
    ...overrides,
  };
}

/** A signed-in browser after `auth:notion`: Notion's cookies, plus what must not be kept. */
const BROWSER_STATE = {
  cookies: [
    cookie('token_v2', '.app.notion.com'),
    cookie('file_token', '.notion.com', { expires: IN_A_MONTH }),
    cookie('notion_browser_id', 'www.notion.so'),
    cookie('_ga', '.google.com'),
    cookie('tracker', '.notion.com.evil.example'),
    cookie('lookalike', 'evilnotion.com'),
  ],
  origins: [
    {
      localStorage: [{ name: 'LRU:KeyValueStore2:current-user-id', value: 'u' }],
      origin: 'https://app.notion.com',
    },
    { localStorage: [{ name: 'k', value: 'v' }], origin: 'https://accounts.google.com' },
    { localStorage: [{ name: 'k', value: 'v' }], origin: 'http://app.notion.com' },
    { localStorage: [{ name: 'k', value: 'v' }], origin: 'not a url' },
  ],
};

const key = createEnvelopeKey(Buffer.alloc(32, 7).toString('base64'));
const otherKey = createEnvelopeKey(Buffer.alloc(32, 8).toString('base64'));

function secretStore(redis: FakeRedis, envelopeKey = key): RedisSecretStore {
  return new RedisSecretStore({
    appEnv: 'dev',
    clock: new ManualClock(NOW),
    key: envelopeKey,
    keyPrefix: keyPrefixFor('dev'),
    redis,
  });
}

describe('isNotionHost', () => {
  it.each([
    ['app.notion.com', true],
    ['.notion.com', true],
    ['FILE.NOTION.COM', true],
    ['www.notion.so', true],
    ['notion.so', true],
    ['evilnotion.com', false],
    ['notion.com.evil.example', false],
    ['notion.site', false],
  ])('%s → %s', (host, expected) => {
    expect(isNotionHost(host)).toBe(expected);
  });
});

describe('captureSession', () => {
  it("keeps only Notion's cookies and the localStorage of Notion's HTTPS origins", () => {
    const captured = captureSession(BROWSER_STATE, FINGERPRINT, NOW);

    expect(captured.storageState.cookies.map(({ domain, name }) => `${name}@${domain}`)).toEqual([
      'token_v2@.app.notion.com',
      'file_token@.notion.com',
      'notion_browser_id@www.notion.so',
    ]);
    expect(captured.storageState.origins.map(({ origin }) => origin)).toEqual([
      'https://app.notion.com',
    ]);
  });

  it('records the earliest sign-in cookie expiry and whether a cookie reaches the file host', () => {
    const captured = captureSession(BROWSER_STATE, FINGERPRINT, NOW);

    expect(captured.authCookieExpiresAt).toBe(new Date(IN_A_MONTH * 1000).toISOString());
    expect(captured.fileHostCookie).toBe(true);
    expect(captured.fingerprint).toEqual(FINGERPRINT);
  });

  it('has no expiry when every sign-in cookie is a session cookie', () => {
    const captured = captureSession(
      { cookies: [cookie('token_v2', '.app.notion.com', { expires: -1 })], origins: [] },
      FINGERPRINT,
      NOW,
    );

    expect(captured.authCookieExpiresAt).toBeUndefined();
  });

  it('reports no file host cookie when only the app has cookies', () => {
    const captured = captureSession(
      { cookies: [cookie('token_v2', '.app.notion.com')], origins: [] },
      FINGERPRINT,
      NOW,
    );

    expect(captured.fileHostCookie).toBe(false);
  });

  it.each([
    ['another cookie for the whole domain', [cookie('notion_user_id', '.notion.com')]],
    ['an expired file_token', [cookie('file_token', '.notion.com', { expires: 1 })]],
    ['a file_token of another host', [cookie('file_token', 'www.notion.so')]],
  ])('reports no file host cookie for %s', (_case, cookies) => {
    const captured = captureSession(
      { cookies: [cookie('token_v2', '.app.notion.com'), ...cookies], origins: [] },
      FINGERPRINT,
      NOW,
    );

    expect(captured.fileHostCookie).toBe(false);
  });

  it.each([
    ['no token_v2', [cookie('file_token', '.notion.com')]],
    [
      'an expired token_v2',
      [cookie('token_v2', '.app.notion.com', { expires: NOW.getTime() / 1000 - 1 })],
    ],
    ['a token_v2 of another site', [cookie('token_v2', '.example.com')]],
  ])('rejects a browser with %s as NOTION_SESSION_EXPIRED', (_case, cookies) => {
    expect(() => captureSession({ cookies, origins: [] }, FINGERPRINT, NOW)).toThrow(
      expect.objectContaining({ code: 'NOTION_SESSION_EXPIRED' }) as Error,
    );
  });

  it('rejects a fingerprint that does not fit the envelope meta', () => {
    expect(() =>
      captureSession(BROWSER_STATE, { ...FINGERPRINT, userAgent: 'x'.repeat(513) }, NOW),
    ).toThrow();
  });
});

describe('sessionMeta', () => {
  it('holds the fingerprint and the cookie facts, never a cookie or storage value', () => {
    const meta = sessionMeta(captureSession(BROWSER_STATE, FINGERPRINT, NOW));

    expect(meta).toEqual({
      authCookieExpiresAt: new Date(IN_A_MONTH * 1000).toISOString(),
      fileHostCookie: true,
      locale: 'en-US',
      timezoneId: 'Europe/Warsaw',
      userAgent: FINGERPRINT.userAgent,
      viewportHeight: 900,
      viewportWidth: 1440,
    });
    expect(JSON.stringify(meta)).not.toContain('value-that-must-stay-secret');
  });

  it('leaves the expiry out when there is none', () => {
    const meta = sessionMeta(
      captureSession(
        { cookies: [cookie('token_v2', '.app.notion.com', { expires: -1 })], origins: [] },
        FINGERPRINT,
        NOW,
      ),
    );

    expect(meta).not.toHaveProperty('authCookieExpiresAt');
  });
});

describe('NotionSessionStore', () => {
  it('saves the storageState encrypted, with the facts as meta, and loads it back', async () => {
    const redis = new FakeRedis();
    const sessions = new NotionSessionStore({ secrets: secretStore(redis) });
    const captured = captureSession(BROWSER_STATE, FINGERPRINT, NOW);

    await sessions.save(captured);

    const raw = redis.strings.get('{nba:dev}:secret:notion-storage-state') ?? '';

    expect(raw).not.toContain('value-that-must-stay-secret');
    expect(JSON.parse(raw)).toMatchObject({ meta: sessionMeta(captured), v: 1 });
    await expect(sessions.load()).resolves.toEqual({ ...captured, createdAt: NOW.toISOString() });
  });

  it('stores what the transfer reads: the file host gets file_token only', async () => {
    const redis = new FakeRedis();

    await new NotionSessionStore({ secrets: secretStore(redis) }).save(
      captureSession(BROWSER_STATE, FINGERPRINT, NOW),
    );

    const stored = await secretStore(redis).get('notion-storage-state');
    const header = cookieHeaderFor(
      parseSessionCookies(stored?.value ?? ''),
      new URL('https://file.notion.com/f/t/x/Export-x.zip'),
      NOW,
    );

    expect(header).toBe('file_token=file_token-value-that-must-stay-secret');
  });

  it('reports a missing session as NOTION_SESSION_EXPIRED', async () => {
    const sessions = new NotionSessionStore({ secrets: secretStore(new FakeRedis()) });

    await expect(sessions.load()).rejects.toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
      message: 'No Notion session is saved',
    });
  });

  it('reports a session sealed with another key as NOTION_SESSION_EXPIRED', async () => {
    const redis = new FakeRedis();

    await new NotionSessionStore({ secrets: secretStore(redis, otherKey) }).save(
      captureSession(BROWSER_STATE, FINGERPRINT, NOW),
    );

    await expect(
      new NotionSessionStore({ secrets: secretStore(redis) }).load(),
    ).rejects.toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
      message: 'The saved Notion session cannot be opened (KEY_MISMATCH)',
    });
  });

  it.each([
    [
      'a value that is not JSON',
      'not json',
      sessionMeta(captureSession(BROWSER_STATE, FINGERPRINT, NOW)),
    ],
    [
      'a value without origins',
      '{"cookies":[]}',
      sessionMeta(captureSession(BROWSER_STATE, FINGERPRINT, NOW)),
    ],
    ['meta without the fingerprint', JSON.stringify({ cookies: [], origins: [] }), {}],
  ])('reports %s as NOTION_SESSION_EXPIRED', async (_case, value, meta) => {
    const secrets: SecretStore = {
      get: () => Promise.resolve({ createdAt: NOW.toISOString(), meta, value }),
      put: () => Promise.resolve(),
    };

    await expect(new NotionSessionStore({ secrets }).load()).rejects.toEqual(
      new IntegrationError('NOTION_SESSION_EXPIRED', 'The saved Notion session is unreadable'),
    );
  });

  it('passes other failures through', async () => {
    const secrets: SecretStore = {
      get: () => Promise.reject(new Error('Redis is down')),
      put: () => Promise.resolve(),
    };

    await expect(new NotionSessionStore({ secrets }).load()).rejects.toThrow('Redis is down');
  });
});
