import type { HashCommands } from '../../src/adapters/persistence/redis-health-store.js';
import type { SetIfAbsentCommands } from '../../src/adapters/persistence/redis-notification-gate.js';
import type { StringCommands } from '../../src/adapters/persistence/redis-secret-store.js';

/**
 * Map-backed string and hash commands, with the raw values visible to tests. `SET` honours
 * `NX` and records `EX`, but keys never expire: tests check the TTL that was asked for.
 */
export class FakeRedis implements HashCommands, SetIfAbsentCommands, StringCommands {
  readonly expirySeconds = new Map<string, number>();
  readonly hashes = new Map<string, Map<string, string>>();
  readonly strings = new Map<string, string>();

  get(key: string): Promise<null | string> {
    // eslint-disable-next-line unicorn/no-null -- mirrors the Redis client, which returns null for a missing key
    return Promise.resolve(this.strings.get(key) ?? null);
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
