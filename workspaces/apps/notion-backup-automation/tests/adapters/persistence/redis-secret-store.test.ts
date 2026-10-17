import { describe, expect, it } from 'vitest';

import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../../src/adapters/persistence/redis-secret-store.js';
import { createEnvelopeKey } from '../../../src/shared/envelope-crypto.js';
import { FakeRedis } from '../../support/fake-redis.js';
import { ManualClock } from '../../support/manual-clock.js';

const key = createEnvelopeKey(Buffer.alloc(32, 7).toString('base64'));
const storageState = JSON.stringify({
  cookies: [{ name: 'token_v2', value: 'session-cookie-value' }],
});
const meta = { authCookieExpiresAt: '2027-10-01T00:00:00.000Z', hasFileHostCookie: true };
const secretKey = '{nba:dev}:secret:notion-storage-state';

function store(redis: FakeRedis, appEnv: 'dev' | 'prod' = 'dev', envelopeKey = key) {
  return new RedisSecretStore({
    appEnv,
    clock: new ManualClock('2026-10-01T04:00:00.000Z'),
    key: envelopeKey,
    keyPrefix: keyPrefixFor('dev'),
    redis,
  });
}

describe('RedisSecretStore', () => {
  it('stores an encrypted envelope under the environment prefix, and reads it back', async () => {
    const redis = new FakeRedis();

    await store(redis).put('notion-storage-state', storageState, meta);

    const raw = redis.strings.get(secretKey) ?? '';

    expect(raw).not.toContain('session-cookie-value');
    expect(JSON.parse(raw)).toMatchObject({ alg: 'A256GCM', kid: key.kid, meta, v: 1 });
    expect(await store(redis).get('notion-storage-state')).toEqual({
      createdAt: '2026-10-01T04:00:00.000Z',
      meta,
      value: storageState,
    });
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await store(new FakeRedis()).get('notion-storage-state')).toBeUndefined();
  });

  it('never opens an envelope from another environment', async () => {
    const redis = new FakeRedis();

    await store(redis, 'dev').put('notion-storage-state', storageState);

    await expect(store(redis, 'prod').get('notion-storage-state')).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });

  it('reports a different encryption key', async () => {
    const redis = new FakeRedis();
    const otherKey = createEnvelopeKey(Buffer.alloc(32, 9).toString('base64'));

    await store(redis).put('notion-storage-state', storageState);

    await expect(store(redis, 'dev', otherKey).get('notion-storage-state')).rejects.toMatchObject({
      code: 'KEY_MISMATCH',
    });
  });

  it('reports a stored value that is not an envelope', async () => {
    const redis = new FakeRedis();

    await redis.set(secretKey, 'not json');

    await expect(store(redis).get('notion-storage-state')).rejects.toMatchObject({
      code: 'ENVELOPE_INVALID',
    });
  });
});
