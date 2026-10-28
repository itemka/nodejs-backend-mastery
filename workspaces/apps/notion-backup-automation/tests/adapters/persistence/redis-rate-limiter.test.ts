import { describe, expect, it } from 'vitest';

import { RedisRateLimiter } from '../../../src/adapters/persistence/redis-rate-limiter.js';
import { RedisTelegramState } from '../../../src/adapters/persistence/redis-telegram-state.js';
import { FakeRedis } from '../../support/fake-redis.js';
import { ManualClock } from '../../support/manual-clock.js';

const PREFIX = '{nba:test}:';
const hourly = { limit: 3, windowSec: 3600 };

describe('RedisRateLimiter', () => {
  it('allows the limit per fixed window, then refuses until the window ends', async () => {
    const redis = new FakeRedis();
    const clock = new ManualClock('2026-10-01T04:15:00.000Z');
    const limiter = new RedisRateLimiter(redis, PREFIX, clock);

    for (let use = 0; use < 3; use += 1) {
      await expect(limiter.take('mcp', hourly)).resolves.toEqual({ allowed: true });
    }

    await expect(limiter.take('mcp', hourly)).resolves.toEqual({
      allowed: false,
      retryAfterSec: 45 * 60,
    });
    await expect(limiter.take('telegram', hourly)).resolves.toEqual({ allowed: true });

    clock.advance(45 * 60 * 1000);

    await expect(limiter.take('mcp', hourly)).resolves.toEqual({ allowed: true });
  });

  it('creates each counter with a TTL beyond its window, before counting', async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRateLimiter(
      redis,
      PREFIX,
      new ManualClock('2026-10-01T04:15:00.000Z'),
    );

    await limiter.take('mcp:process:2026-10', hourly);

    const key = `${PREFIX}ratelimit:mcp:process:2026-10:${Date.parse('2026-10-01T04:00:00.000Z') / 1000}`;

    expect(redis.strings.get(key)).toBe('1');
    expect(redis.expirySeconds.get(key)).toBe(45 * 60 + 60);
  });

  it('refuses a malformed name or limit', async () => {
    const limiter = new RedisRateLimiter(new FakeRedis(), PREFIX);

    await expect(limiter.take('a b', hourly)).rejects.toThrow(RangeError);
    await expect(limiter.take('mcp', { limit: 0, windowSec: 60 })).rejects.toThrow(RangeError);
  });
});

describe('RedisTelegramState', () => {
  it('claims each update once, for two days', async () => {
    const redis = new FakeRedis();
    const state = new RedisTelegramState(redis, PREFIX);

    await expect(state.claimUpdate(42)).resolves.toBe('claimed');
    await expect(state.claimUpdate(42)).resolves.toBe('busy');
    expect(redis.expirySeconds.get(`${PREFIX}telegram:update:42`)).toBe(60);
    await state.completeUpdate(42);
    await expect(state.claimUpdate(42)).resolves.toBe('completed');
    expect(redis.expirySeconds.get(`${PREFIX}telegram:update:42`)).toBe(172_800);
  });

  it('returns a confirmation once', async () => {
    const redis = new FakeRedis();
    const state = new RedisTelegramState(redis, PREFIX);
    const nonce = 'abcdefghijklmnop_-012';

    await state.saveConfirmation(nonce, '{"action":"cancel"}', 600);

    expect(redis.expirySeconds.get(`${PREFIX}telegram:confirm:${nonce}`)).toBe(600);
    await expect(state.claimConfirmation(nonce)).resolves.toBe('{"action":"cancel"}');
    await expect(state.claimConfirmation(nonce)).resolves.toBe('busy');
    await state.completeConfirmation(nonce);
    await expect(state.claimConfirmation(nonce)).resolves.toBeUndefined();
    await expect(state.claimConfirmation('../x')).resolves.toBeUndefined();
  });

  it('recovers an expired processing lease without letting its old owner complete or release a new one', async () => {
    const redis = new FakeRedis();
    const oldOwner = new RedisTelegramState(redis, PREFIX);
    const newOwner = new RedisTelegramState(redis, PREFIX);
    const key = `${PREFIX}telegram:update:81`;

    await expect(oldOwner.claimUpdate(81)).resolves.toBe('claimed');
    await expect(newOwner.claimUpdate(81)).resolves.toBe('busy');
    // Model Redis expiring the processing lease; done receipts have a separate 48-hour TTL.
    redis.strings.delete(key);
    await expect(newOwner.claimUpdate(81)).resolves.toBe('claimed');
    const newToken = redis.strings.get(key);

    await expect(oldOwner.completeUpdate(81)).rejects.toThrow('lease expired');
    await oldOwner.releaseUpdate(81);
    expect(redis.strings.get(key)).toBe(newToken);
    await newOwner.completeUpdate(81);
    await expect(oldOwner.claimUpdate(81)).resolves.toBe('completed');
  });

  it('releases a confirmation lease on failure while retaining its pending action', async () => {
    const redis = new FakeRedis();
    const state = new RedisTelegramState(redis, PREFIX);
    const competing = new RedisTelegramState(redis, PREFIX);
    const nonce = 'abcdefghijklmnop_-012';

    await state.saveConfirmation(nonce, '{"action":"cancel"}', 600);
    await expect(state.claimConfirmation(nonce)).resolves.toBe('{"action":"cancel"}');
    await expect(competing.claimConfirmation(nonce)).resolves.toBe('busy');
    await state.releaseConfirmation(nonce);
    await expect(competing.claimConfirmation(nonce)).resolves.toBe('{"action":"cancel"}');
    await state.releaseConfirmation(nonce);
    await competing.completeConfirmation(nonce);
    await expect(state.claimConfirmation(nonce)).resolves.toBeUndefined();
  });
});
