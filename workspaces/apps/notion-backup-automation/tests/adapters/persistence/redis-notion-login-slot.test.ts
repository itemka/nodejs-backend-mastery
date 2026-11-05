import { describe, expect, it } from 'vitest';

import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import {
  InMemoryNotionLoginSlot,
  RedisNotionLoginSlot,
} from '../../../src/adapters/persistence/redis-notion-login-slot.js';
import { FakeRedis } from '../../support/fake-redis.js';
import { ManualClock } from '../../support/manual-clock.js';

const FIRST = 'attempt-first-0123456789';
const SECOND = 'attempt-second-012345678';

describe('RedisNotionLoginSlot', () => {
  it('lets the first attempt claim the day, and only that attempt hold it', async () => {
    const redis = new FakeRedis();
    const slot = new RedisNotionLoginSlot(redis, keyPrefixFor('prod'));

    await expect(slot.claim(FIRST, 86_400)).resolves.toBe(true);
    await expect(slot.claim(SECOND, 86_400)).resolves.toBe(false);
    await expect(slot.holds(FIRST)).resolves.toBe(true);
    await expect(slot.holds(SECOND)).resolves.toBe(false);
    await expect(slot.holds('x')).resolves.toBe(false);
    expect(redis.strings.get('{nba:prod}:notion-login:attempt')).toBe(FIRST);
  });

  it('refuses a malformed attempt or TTL', async () => {
    const slot = new RedisNotionLoginSlot(new FakeRedis(), keyPrefixFor('prod'));

    await expect(slot.claim('short', 60)).rejects.toThrow(RangeError);
    await expect(slot.claim(FIRST, 0)).rejects.toThrow(RangeError);
  });
});

describe('InMemoryNotionLoginSlot', () => {
  it('frees the slot once its TTL ends', async () => {
    const clock = new ManualClock('2026-11-05T15:00:00.000Z');
    const slot = new InMemoryNotionLoginSlot(clock);

    await expect(slot.claim(FIRST, 60)).resolves.toBe(true);
    await expect(slot.claim(SECOND, 60)).resolves.toBe(false);
    clock.advance(60_000);
    await expect(slot.holds(FIRST)).resolves.toBe(false);
    await expect(slot.claim(SECOND, 60)).resolves.toBe(true);
    await expect(slot.holds(SECOND)).resolves.toBe(true);
  });
});
