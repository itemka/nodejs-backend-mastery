import type { NotionLoginSlot } from '../../application/ports.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import { persistenceKeys } from './keys.js';

/** `SET NX EX` and `GET`; `@upstash/redis` and test fakes both provide them. */
export interface SlotCommands {
  get(key: string): Promise<null | string>;
  /** `OK` when the key was set, null when it already existed. */
  set(key: string, value: string, options: { ex: number; nx: true }): Promise<unknown>;
}

const attemptPattern = /^[\w-]{16,64}$/;

/**
 * `notion-login:attempt` holds the ID of the day's one automatic login: the first claim within
 * the TTL wins, atomically across functions, and the worker runs a delivery only while its
 * attempt still holds the key.
 */
export class RedisNotionLoginSlot implements NotionLoginSlot {
  private readonly key: string;
  private readonly redis: SlotCommands;

  constructor(redis: SlotCommands, keyPrefix: string) {
    this.key = persistenceKeys(keyPrefix).notionLoginAttempt;
    this.redis = redis;
  }

  async claim(attempt: string, ttlSec: number): Promise<boolean> {
    assertClaim(attempt, ttlSec);

    return (await this.redis.set(this.key, attempt, { ex: ttlSec, nx: true })) === 'OK';
  }

  async holds(attempt: string): Promise<boolean> {
    return attemptPattern.test(attempt) && (await this.redis.get(this.key)) === attempt;
  }
}

/** The same semantics in memory, for tests and local runs. */
export class InMemoryNotionLoginSlot implements NotionLoginSlot {
  private claimed: { readonly attempt: string; readonly expiresAtMs: number } | undefined;
  private readonly clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  claim(attempt: string, ttlSec: number): Promise<boolean> {
    assertClaim(attempt, ttlSec);

    const now = this.clock.now().getTime();

    if (this.claimed !== undefined && this.claimed.expiresAtMs > now) {
      return Promise.resolve(false);
    }

    this.claimed = { attempt, expiresAtMs: now + ttlSec * 1000 };

    return Promise.resolve(true);
  }

  holds(attempt: string): Promise<boolean> {
    const live =
      this.claimed !== undefined && this.claimed.expiresAtMs > this.clock.now().getTime();

    return Promise.resolve(live && this.claimed?.attempt === attempt);
  }
}

function assertClaim(attempt: string, ttlSec: number): void {
  if (!attemptPattern.test(attempt) || !Number.isInteger(ttlSec) || ttlSec < 1) {
    throw new RangeError('Expected an attempt ID and a TTL of whole seconds');
  }
}
