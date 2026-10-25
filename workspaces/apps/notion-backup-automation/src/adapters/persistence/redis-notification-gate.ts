import type { NotificationGate } from '../../application/ports.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import { persistenceKeys } from './keys.js';

/** `SET NX EX`; `@upstash/redis` and test fakes both provide it. */
export interface SetIfAbsentCommands {
  /** `OK` when the key was set, null when it already existed. */
  set(key: string, value: string, options: { ex: number; nx: true }): Promise<unknown>;
}

const keyPattern = /^[\w.:-]{1,200}$/;

/**
 * `notify:<key>` with `SET NX EX`: the first claim within the TTL wins, atomically, across
 * functions. The value is the claim's time, for inspecting a skipped notification.
 */
export class RedisNotificationGate implements NotificationGate {
  private readonly clock: Clock;
  private readonly keys;
  private readonly redis: SetIfAbsentCommands;

  constructor(redis: SetIfAbsentCommands, keyPrefix: string, clock: Clock = systemClock) {
    this.clock = clock;
    this.keys = persistenceKeys(keyPrefix);
    this.redis = redis;
  }

  async claim(key: string, ttlSec: number): Promise<boolean> {
    assertClaim(key, ttlSec);

    const reply = await this.redis.set(this.keys.notify(key), this.clock.now().toISOString(), {
      ex: ttlSec,
      nx: true,
    });

    return reply === 'OK';
  }
}

/** The same semantics in memory, for tests and local runs. */
export class InMemoryNotificationGate implements NotificationGate {
  private readonly claims = new Map<string, number>();
  private readonly clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  claim(key: string, ttlSec: number): Promise<boolean> {
    assertClaim(key, ttlSec);

    const now = this.clock.now().getTime();
    const expiresAt = this.claims.get(key);

    if (expiresAt !== undefined && expiresAt > now) {
      return Promise.resolve(false);
    }

    this.claims.set(key, now + ttlSec * 1000);

    return Promise.resolve(true);
  }
}

function assertClaim(key: string, ttlSec: number): void {
  if (!keyPattern.test(key) || !Number.isInteger(ttlSec) || ttlSec < 1) {
    throw new RangeError('Expected a short key and a TTL of whole seconds');
  }
}
