import { describe, expect, it } from 'vitest';

import { RedisDeliveryState } from '../src/adapters/redis-state.js';
import type { RedisCommands } from '../src/adapters/redis-state.js';

/** Offline Redis command harness, including expiry and atomic script preconditions. */
class ScriptRedis implements RedisCommands {
  readonly values = new Map<string, { expiresAt: number; value: string }>();
  readonly calls: { args: (number | string)[]; keys: string[]; script: string }[] = [];
  now = 0;

  get(key: string): string | undefined {
    const record = this.values.get(key);

    if (record === undefined || record.expiresAt <= this.now) {
      this.values.delete(key);

      return undefined;
    }

    return record.value;
  }

  private set(key: string, value: string, ttlSec: number): void {
    this.values.set(key, { expiresAt: this.now + ttlSec * 1000, value });
  }

  eval(script: string, keys: string[], args: (number | string)[]): Promise<unknown> {
    this.calls.push({ args, keys, script });
    const first = keys[0]!;
    const second = keys[1]!;
    const token = String(args[0]);

    if (script.includes("return 'busy'")) {
      expect(script).toContain("if redis.call('EXISTS', KEYS[1]) == 1 then return 'done' end");
      expect(script).toContain("redis.call('SET', KEYS[2], ARGV[1], 'NX', 'EX', 60)");

      if (this.get(first) !== undefined) {
        return Promise.resolve('done');
      }

      if (this.get(second) !== undefined) {
        return Promise.resolve('busy');
      }

      this.set(second, token, 60);

      return Promise.resolve('claimed');
    }

    if (script.includes("redis.call('DEL', KEYS[2])")) {
      expect(
        script.indexOf("if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end"),
      ).toBeGreaterThanOrEqual(0);
      expect(script.indexOf("if redis.call('GET', KEYS[2])")).toBeLessThan(
        script.indexOf("redis.call('SET'"),
      );

      if (this.get(second) !== token) {
        return Promise.resolve(0);
      }

      this.set(first, '1', 172_800);
      this.values.delete(second);

      return Promise.resolve(1);
    }

    if (script.includes("redis.call('INCR', KEYS[2])")) {
      expect(script).toContain("if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end");
      expect(script).toContain('if count >= 30 then return 0 end');
      expect(script).toContain("redis.call('EXPIRE', KEYS[2], ARGV[1])");
      expect(script).toContain("redis.call('SET', KEYS[1], '1', 'EX', 172800)");

      if (this.get(first) !== undefined) {
        return Promise.resolve(1);
      }

      const count = Number(this.get(second) ?? 0);

      if (count >= 30) {
        return Promise.resolve(0);
      }

      this.set(second, String(count + 1), Number(args[0]));
      this.set(first, '1', 172_800);

      return Promise.resolve(1);
    }

    expect(script).toContain(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end",
    );

    if (this.get(first) === token) {
      this.values.delete(first);

      return Promise.resolve(1);
    }

    return Promise.resolve(0);
  }
}

describe('Redis delivery state', () => {
  it('claims once, reports a concurrent delivery busy, and records completion for 48 hours', async () => {
    const redis = new ScriptRedis();
    const state = new RedisDeliveryState(redis, 'hub:test', () => redis.now);
    expect(await state.claim(12, 'first')).toBe('claimed');
    expect(await state.claim(12, 'second')).toBe('busy');
    expect(redis.values.get('hub:test:processing:12')?.expiresAt).toBe(60_000);
    await state.complete(12, 'first');
    expect(await state.claim(12, 'third')).toBe('done');
    expect(redis.values.get('hub:test:done:12')?.expiresAt).toBe(172_800_000);
    expect(redis.get('hub:test:processing:12')).toBeUndefined();
  });

  it('never releases or completes a newer worker lease with a stale owner token', async () => {
    const redis = new ScriptRedis();
    const state = new RedisDeliveryState(redis, 'hub:test', () => redis.now);
    await state.claim(1, 'old');
    redis.now = 60_001;
    expect(await state.claim(1, 'new')).toBe('claimed');
    await state.release(1, 'old');
    expect(redis.get('hub:test:processing:1')).toBe('new');
    await expect(state.complete(1, 'old')).rejects.toThrow('Delivery lease expired');
    expect(redis.get('hub:test:done:1')).toBeUndefined();
    expect(redis.get('hub:test:processing:1')).toBe('new');
  });

  it('permits retry after release and counts a previously admitted update only once', async () => {
    const redis = new ScriptRedis();
    const state = new RedisDeliveryState(redis, 'hub:test', () => redis.now);
    await state.claim(1, 'one');
    expect(await state.allow(1)).toBe(true);
    await state.release(1, 'one');
    expect(await state.claim(1, 'two')).toBe('claimed');
    expect(await state.allow(1)).toBe(true);
    expect(redis.get('hub:test:rate:0')).toBe('1');
  });

  it('admits 30 unique updates per fixed hour, while admitted retries bypass the full quota', async () => {
    const redis = new ScriptRedis();
    redis.now = 1000;
    const state = new RedisDeliveryState(redis, 'hub:test', () => redis.now);

    for (let updateId = 0; updateId < 30; updateId++) {
      expect(await state.allow(updateId)).toBe(true);
    }

    expect(await state.allow(30)).toBe(false);
    expect(await state.allow(1)).toBe(true);
    expect(redis.values.get('hub:test:rate:0')?.expiresAt).toBe(3_600_000);
    redis.now = 3_600_000;
    expect(await state.allow(30)).toBe(true);
    expect(redis.get('hub:test:rate:0')).toBeUndefined();
    expect(redis.get('hub:test:rate:1')).toBe('1');
  });

  it('keeps namespaces independent even with the same update ID', async () => {
    const redis = new ScriptRedis();
    const prod = new RedisDeliveryState(redis, 'hub:prod', () => redis.now);
    const dev = new RedisDeliveryState(redis, 'hub:dev', () => redis.now);
    await prod.claim(1, 'prod');
    await prod.complete(1, 'prod');
    expect(await dev.claim(1, 'dev')).toBe('claimed');
    expect(await prod.claim(1, 'again')).toBe('done');
  });
});
