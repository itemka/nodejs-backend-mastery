import type { HealthField, HealthSnapshot } from '../../application/health-snapshot.js';
import { healthFields, healthSnapshotSchema } from '../../application/health-snapshot.js';
import type { HealthStore } from '../../application/ports.js';
import { persistenceKeys } from './keys.js';

/** The two hash commands the store needs; `@upstash/redis` and test fakes both provide them. */
export interface HashCommands {
  /** The raw reply: a flat `[field, value, …]` array, or an object from a deserializing client. */
  hgetall(key: string): Promise<unknown>;
  hset(key: string, values: Record<string, string>): Promise<unknown>;
}

/**
 * Probe results in the `health` hash, one JSON field per probe. A probe overwrites only its own
 * field, and a field that fails its schema reads as unknown instead of failing the snapshot.
 */
export class RedisHealthStore implements HealthStore {
  private readonly key: string;
  private readonly redis: HashCommands;

  constructor(redis: HashCommands, keyPrefix: string) {
    this.key = persistenceKeys(keyPrefix).health;
    this.redis = redis;
  }

  async read(): Promise<HealthSnapshot> {
    const hash = toRecord(await this.redis.hgetall(this.key));
    const snapshot: Record<string, unknown> = {};

    for (const field of healthFields) {
      const raw = hash[field];

      if (typeof raw !== 'string') {
        continue;
      }

      try {
        const parsed = healthSnapshotSchema.shape[field].safeParse(JSON.parse(raw));

        if (parsed.success && parsed.data !== undefined) {
          snapshot[field] = parsed.data;
        }
      } catch {
        // Unreadable JSON: the probe's result is unknown until it runs again.
      }
    }

    return healthSnapshotSchema.parse(snapshot);
  }

  async write<F extends HealthField>(
    field: F,
    value: NonNullable<HealthSnapshot[F]>,
  ): Promise<void> {
    const parsed = healthSnapshotSchema.shape[field].parse(value);

    await this.redis.hset(this.key, { [field]: JSON.stringify(parsed) });
  }
}

function toRecord(reply: unknown): Record<string, unknown> {
  if (Array.isArray(reply)) {
    const record: Record<string, unknown> = {};

    for (let index = 0; index + 1 < reply.length; index += 2) {
      record[String(reply[index])] = reply[index + 1];
    }

    return record;
  }

  return typeof reply === 'object' && reply !== null ? { ...reply } : {};
}
