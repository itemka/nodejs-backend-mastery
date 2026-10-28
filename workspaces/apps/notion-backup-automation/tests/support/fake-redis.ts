import type { HashCommands } from '../../src/adapters/persistence/redis-health-store.js';
import type { SetIfAbsentCommands } from '../../src/adapters/persistence/redis-notification-gate.js';
import type { CounterCommands } from '../../src/adapters/persistence/redis-rate-limiter.js';
import type { StringCommands } from '../../src/adapters/persistence/redis-secret-store.js';

/**
 * Map-backed string and hash commands, with the raw values visible to tests. `SET` honours
 * `NX` and records `EX`, but keys never expire: tests check the TTL that was asked for.
 */
export class FakeRedis
  implements CounterCommands, HashCommands, SetIfAbsentCommands, StringCommands
{
  readonly expirySeconds = new Map<string, number>();
  readonly hashes = new Map<string, Map<string, string>>();
  readonly strings = new Map<string, string>();

  get(key: string): Promise<null | string> {
    // eslint-disable-next-line unicorn/no-null -- mirrors the Redis client, which returns null for a missing key
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  /** `GETDEL`: the value, removed in the same step. */
  getdel(key: string): Promise<null | string> {
    const value = this.strings.get(key);

    this.strings.delete(key);
    this.expirySeconds.delete(key);

    // eslint-disable-next-line unicorn/no-null -- mirrors the Redis client, which returns null for a missing key
    return Promise.resolve(value ?? null);
  }

  /** The raw Redis reply: a flat `[field, value, …]` array, empty for a missing key. */
  hgetall(key: string): Promise<string[]> {
    return Promise.resolve([...(this.hashes.get(key) ?? new Map<string, string>())].flat());
  }

  hset(key: string, values: Record<string, string>): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();

    for (const [field, value] of Object.entries(values)) {
      hash.set(field, value);
    }

    this.hashes.set(key, hash);

    return Promise.resolve(Object.keys(values).length);
  }

  /** `INCR` on a string counter, keeping its TTL, as Redis does. */
  incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + 1;

    this.strings.set(key, String(next));

    return Promise.resolve(next);
  }

  /** The Telegram receipt scripts, executed atomically by this synchronous fake. */
  eval<T>(script: string, keys: string[], args: unknown[]): Promise<T> {
    const key = keys[0] ?? '';
    const token = String(args[0]);
    const current = this.strings.get(key);
    let result: unknown = 0;

    if (script.includes('nba-action-bind')) {
      if (current !== undefined) {
        return Promise.resolve((current === token ? 1 : 0) as T);
      }

      this.strings.set(key, token);
      this.expirySeconds.set(key, Number(args[1]));

      return Promise.resolve(1 as T);
    }

    if (script.includes('nba-confirm-claim')) {
      const leaseKey = keys[1] ?? '';

      if (current === undefined) {
        // eslint-disable-next-line unicorn/no-null -- Redis returns null for Lua's false/missing confirmation
        return Promise.resolve(null as T);
      }

      if (this.strings.has(leaseKey)) {
        return Promise.resolve('busy' as T);
      }

      this.strings.set(leaseKey, token);
      this.expirySeconds.set(leaseKey, Number(args[1]));

      return Promise.resolve(current as T);
    }

    if (script.includes('nba-confirm-complete')) {
      const leaseKey = keys[1] ?? '';

      if (this.strings.get(leaseKey) === token) {
        this.strings.delete(key);
        this.expirySeconds.delete(key);
        this.strings.delete(leaseKey);
        this.expirySeconds.delete(leaseKey);
        result = 1;
      }
    } else if (script.includes('nba-telegram-claim')) {
      result = current === undefined ? 1 : 2;

      if (current === 'done') {
        result = 0;
      }

      if (result === 1) {
        this.strings.set(key, token);
        this.expirySeconds.set(key, Number(args[1]));
      }
    } else if (script.includes('nba-telegram-complete')) {
      if (current === token) {
        this.strings.set(key, 'done');
        this.expirySeconds.set(key, Number(args[1]));
        result = 1;
      }
    } else if (script.includes('nba-telegram-release')) {
      if (current === token) {
        this.strings.delete(key);
        this.expirySeconds.delete(key);
        result = 1;
      }
    } else {
      throw new Error('Unexpected Redis script');
    }

    return Promise.resolve(result as T);
  }

  ping(): Promise<'PONG'> {
    return Promise.resolve('PONG');
  }

  set(
    key: string,
    value: string,
    options: { ex?: number; nx?: boolean } = {},
  ): Promise<'OK' | null> {
    if (options.nx === true && this.strings.has(key)) {
      // eslint-disable-next-line unicorn/no-null -- mirrors the Redis client, which returns null when NX finds the key
      return Promise.resolve(null);
    }

    this.strings.set(key, value);

    if (options.ex === undefined) {
      this.expirySeconds.delete(key);
    } else {
      this.expirySeconds.set(key, options.ex);
    }

    return Promise.resolve('OK');
  }
}
