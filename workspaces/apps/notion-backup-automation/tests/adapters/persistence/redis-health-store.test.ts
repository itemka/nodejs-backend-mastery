import { describe, expect, it } from 'vitest';

import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import { RedisHealthStore } from '../../../src/adapters/persistence/redis-health-store.js';
import { FakeRedis } from '../../support/fake-redis.js';

const notionSession = { checkedAt: '2026-10-01T04:00:00.000Z', state: 'valid' } as const;
const qstashPing = { nonce: 'nonce-1234abcd', receivedAt: '2026-10-01T04:01:00.000Z' };

describe('RedisHealthStore', () => {
  it('reads an empty snapshot before any probe ran', async () => {
    expect(await new RedisHealthStore(new FakeRedis(), keyPrefixFor('prod')).read()).toEqual({});
  });

  it('lets each probe overwrite only its own field', async () => {
    const redis = new FakeRedis();
    const store = new RedisHealthStore(redis, keyPrefixFor('prod'));

    await store.write('notionSession', notionSession);
    await store.write('qstashPing', qstashPing);
    await store.write('notionSession', { ...notionSession, state: 'expired' });

    expect([...(redis.hashes.get('{nba:prod}:health')?.keys() ?? [])]).toEqual([
      'notionSession',
      'qstashPing',
    ]);
    expect(await store.read()).toEqual({
      notionSession: { ...notionSession, state: 'expired' },
      qstashPing,
    });
  });

  it('refuses to write a value that fails the field schema', async () => {
    const store = new RedisHealthStore(new FakeRedis(), keyPrefixFor('prod'));

    await expect(
      store.write('qstashPing', { nonce: 'bad nonce!', receivedAt: 'yesterday' }),
    ).rejects.toThrow();
  });

  it('reads an unreadable field as unknown instead of failing the snapshot', async () => {
    const redis = new FakeRedis();
    const store = new RedisHealthStore(redis, keyPrefixFor('prod'));

    await store.write('qstashPing', qstashPing);
    await redis.hset('{nba:prod}:health', {
      cron: '{"ranAt":"not a time"}',
      notionSession: 'not json',
    });

    expect(await store.read()).toEqual({ qstashPing });
  });
});
