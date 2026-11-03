import { describe, expect, it } from 'vitest';

import { GoogleRefreshTokenStore } from '../../../src/adapters/google/refresh-token-store.js';
import type { StoredTokenProviderOptions } from '../../../src/adapters/google/token-provider.js';
import { StoredTokenProvider } from '../../../src/adapters/google/token-provider.js';
import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../../src/adapters/persistence/redis-secret-store.js';
import { createEnvelopeKey } from '../../../src/shared/envelope-crypto.js';
import {
  WEB_CLIENT_ID,
  WEB_CLIENT_SECRET,
  WEB_REFRESH_TOKEN,
} from '../../support/fake-google-identity.js';
import {
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  GMAIL_SCOPE,
} from '../../support/fake-google.js';
import { FakeRedis } from '../../support/fake-redis.js';

const key = createEnvelopeKey(Buffer.alloc(32, 7).toString('base64'));
const desktop = { clientId: fakeCredentials.clientId, clientSecret: fakeCredentials.clientSecret };
const web = { clientId: WEB_CLIENT_ID, clientSecret: WEB_CLIENT_SECRET };

function tokenStore(redis = new FakeRedis(), envelopeKey = key) {
  return new GoogleRefreshTokenStore(
    new RedisSecretStore({
      appEnv: 'prod',
      key: envelopeKey,
      keyPrefix: keyPrefixFor('prod'),
      redis,
    }),
  );
}

function provider(
  google: FakeGoogle,
  store: Pick<GoogleRefreshTokenStore, 'read'>,
  options: Partial<StoredTokenProviderOptions> = {},
) {
  return new StoredTokenProvider({
    clients: { desktop, web },
    fetch: google.fetch,
    retries: 0,
    store,
    ...options,
  });
}

/** The refresh request's client and token. */
function refreshForm(google: FakeGoogle): URLSearchParams {
  return new URLSearchParams(google.requestsTo('oauth2.googleapis.com/token')[0]?.body);
}

describe('StoredTokenProvider', () => {
  it('prefers the stored envelope over GOOGLE_REFRESH_TOKEN, with the client it names', async () => {
    const store = tokenStore();
    const google = new FakeGoogle().onRefresh();

    await store.save({
      client: 'web',
      refreshToken: WEB_REFRESH_TOKEN,
      scopes: [GMAIL_SCOPE, DRIVE_SCOPE],
    });

    await expect(
      provider(google, store, {
        fallbackRefreshToken: fakeCredentials.refreshToken,
      }).getAccessToken(),
    ).resolves.toBe(fakeCredentials.accessToken);

    const form = refreshForm(google);

    expect(form.get('refresh_token')).toBe(WEB_REFRESH_TOKEN);
    expect(form.get('client_id')).toBe(WEB_CLIENT_ID);
  });

  it('refreshes a desktop envelope from auth:google with the Desktop client', async () => {
    const store = tokenStore();
    const google = new FakeGoogle().onRefresh();

    await store.save({
      client: 'desktop',
      refreshToken: fakeCredentials.refreshToken,
      scopes: [GMAIL_SCOPE, DRIVE_SCOPE],
    });

    await expect(provider(google, store).grantedScopes()).resolves.toEqual([
      GMAIL_SCOPE,
      DRIVE_SCOPE,
    ]);
    expect(refreshForm(google).get('client_id')).toBe(fakeCredentials.clientId);
  });

  it('falls back to GOOGLE_REFRESH_TOKEN with the Desktop client while none is stored', async () => {
    const google = new FakeGoogle().onRefresh();

    await provider(google, tokenStore(), {
      fallbackRefreshToken: fakeCredentials.refreshToken,
    }).getAccessToken();

    expect(refreshForm(google).get('refresh_token')).toBe(fakeCredentials.refreshToken);
    expect(refreshForm(google).get('client_id')).toBe(fakeCredentials.clientId);
  });

  it('is GOOGLE_AUTH_REQUIRED with neither an envelope nor GOOGLE_REFRESH_TOKEN', async () => {
    await expect(provider(new FakeGoogle(), tokenStore()).getAccessToken()).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
      message:
        'No Google refresh token: none is stored for APP_ENV, and GOOGLE_REFRESH_TOKEN is unset',
    });
  });

  it('is CONFIG_INCOMPLETE for a web envelope while the Web client is not configured', async () => {
    const store = tokenStore();

    await store.save({ client: 'web', refreshToken: WEB_REFRESH_TOKEN, scopes: [] });

    await expect(
      provider(new FakeGoogle(), store, { clients: { desktop } }).getAccessToken(),
    ).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE' });
  });

  it('is GOOGLE_AUTH_REQUIRED for an envelope sealed with another key', async () => {
    const redis = new FakeRedis();

    await tokenStore(redis, createEnvelopeKey(Buffer.alloc(32, 9).toString('base64'))).save({
      client: 'web',
      refreshToken: WEB_REFRESH_TOKEN,
      scopes: [],
    });

    const error = await provider(new FakeGoogle(), tokenStore(redis))
      .getAccessToken()
      .catch((error_: unknown) => error_);

    expect(error).toMatchObject({ code: 'GOOGLE_AUTH_REQUIRED' });
    expect(String((error as Error).message)).not.toContain(WEB_REFRESH_TOKEN);
  });

  it('reads the store once, and again after a failed read', async () => {
    const google = new FakeGoogle().onRefresh();
    const empty = tokenStore();
    let reads = 0;
    const store: StoredTokenProviderOptions['store'] = {
      read: () => {
        reads += 1;

        return reads === 1 ? Promise.reject(new Error('redis down')) : empty.read();
      },
    };
    const tokens = provider(google, store, { fallbackRefreshToken: fakeCredentials.refreshToken });

    await expect(tokens.getAccessToken()).rejects.toThrow('redis down');
    await tokens.getAccessToken();
    await tokens.getAccessToken();

    expect(reads).toBe(2);
  });
});

describe('StoredTokenProvider for the CLI (review, 2026-11-02)', () => {
  it('names the token it refreshes, for doctor', async () => {
    const store = tokenStore();

    await expect(
      provider(new FakeGoogle().onRefresh(), store, {
        fallbackRefreshToken: fakeCredentials.refreshToken,
      }).source(),
    ).resolves.toEqual({ client: 'desktop', stored: false });

    await store.save({
      client: 'web',
      refreshToken: WEB_REFRESH_TOKEN,
      scopes: [GMAIL_SCOPE, DRIVE_SCOPE],
    });

    await expect(provider(new FakeGoogle().onRefresh(), store).source()).resolves.toEqual({
      client: 'web',
      stored: true,
    });
  });

  it('refreshes GOOGLE_REFRESH_TOKEN alone without a store, as the CLI runs without Redis', async () => {
    const google = new FakeGoogle().onRefresh();
    const tokens = new StoredTokenProvider({
      clients: { desktop },
      fallbackRefreshToken: fakeCredentials.refreshToken,
      fetch: google.fetch,
      retries: 0,
    });

    await expect(tokens.getAccessToken()).resolves.toBe(fakeCredentials.accessToken);
    expect(refreshForm(google).get('refresh_token')).toBe(fakeCredentials.refreshToken);
    await expect(tokens.source()).resolves.toEqual({ client: 'desktop', stored: false });
  });
});

describe('GoogleRefreshTokenStore', () => {
  it('seals the token, with its client and scopes as authenticated metadata only', async () => {
    const redis = new FakeRedis();

    await tokenStore(redis).save({
      client: 'web',
      refreshToken: WEB_REFRESH_TOKEN,
      scopes: [GMAIL_SCOPE, DRIVE_SCOPE],
    });

    const raw = redis.strings.get('{nba:prod}:secret:google-refresh-token') ?? '';

    expect(raw).not.toContain(WEB_REFRESH_TOKEN);
    expect(JSON.parse(raw)).toMatchObject({
      meta: { client: 'web', scopes: `${GMAIL_SCOPE} ${DRIVE_SCOPE}` },
    });

    const stored = await tokenStore(redis).read();

    expect(stored).toMatchObject({ client: 'web', scopes: [GMAIL_SCOPE, DRIVE_SCOPE] });
    expect(stored?.refreshToken.reveal()).toBe(WEB_REFRESH_TOKEN);
    expect(JSON.stringify(stored)).not.toContain(WEB_REFRESH_TOKEN);
  });
});
