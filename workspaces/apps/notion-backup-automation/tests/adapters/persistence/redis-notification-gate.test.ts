import { describe, expect, it } from 'vitest';

import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import {
  InMemoryNotificationGate,
  RedisNotificationGate,
} from '../../../src/adapters/persistence/redis-notification-gate.js';
import { FakeRedis } from '../../support/fake-redis.js';
import { ManualClock } from '../../support/manual-clock.js';

const DAY_SEC = 86_400;

describe('RedisNotificationGate', () => {
  it('claims notify:<key> once with SET NX EX, recording the claim time', async () => {
    const redis = new FakeRedis();
    const gate = new RedisNotificationGate(
      redis,
      keyPrefixFor('test'),
      new ManualClock('2026-10-01T04:00:00.000Z'),
    );
    const key = '{nba:test}:notify:attention:2026-10:NOTION_SESSION_EXPIRED';

    await expect(gate.claim('attention:2026-10:NOTION_SESSION_EXPIRED', DAY_SEC)).resolves.toBe(
      true,
    );
    await expect(gate.claim('attention:2026-10:NOTION_SESSION_EXPIRED', DAY_SEC)).resolves.toBe(
      false,
    );

    expect(redis.strings.get(key)).toBe('2026-10-01T04:00:00.000Z');
    expect(redis.expirySeconds.get(key)).toBe(DAY_SEC);
    await expect(gate.claim('attention:2026-10:NOTION_UI_CHANGED', DAY_SEC)).resolves.toBe(true);
  });

  it.each([
    ['an empty key', '', DAY_SEC],
    ['a key with spaces', 'lost: notion', DAY_SEC],
    ['a zero TTL', 'lost:notion', 0],
    ['a fractional TTL', 'lost:notion', 1.5],
  ])('refuses %s', async (_case, key, ttl) => {
    await expect(
      new RedisNotificationGate(new FakeRedis(), keyPrefixFor('test')).claim(key, ttl),
    ).rejects.toThrow(RangeError);
  });
});

describe('InMemoryNotificationGate', () => {
  it('lets the same key through again once its TTL has passed', async () => {
    const clock = new ManualClock('2026-10-01T04:00:00.000Z');
    const gate = new InMemoryNotificationGate(clock);

    await expect(gate.claim('lost:notion', DAY_SEC)).resolves.toBe(true);
    clock.advance(DAY_SEC * 1000 - 1);
    await expect(gate.claim('lost:notion', DAY_SEC)).resolves.toBe(false);
    clock.advance(1);
    await expect(gate.claim('lost:notion', DAY_SEC)).resolves.toBe(true);
  });
});
