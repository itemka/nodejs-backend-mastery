import type { HashCommands } from '../../src/adapters/persistence/redis-health-store.js';
import type { StringCommands } from '../../src/adapters/persistence/redis-secret-store.js';

/** Map-backed string and hash commands, with the raw values visible to tests. */
export class FakeRedis implements HashCommands, StringCommands {
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

  set(key: string, value: string): Promise<'OK'> {
    this.strings.set(key, value);

    return Promise.resolve('OK');
  }
}
