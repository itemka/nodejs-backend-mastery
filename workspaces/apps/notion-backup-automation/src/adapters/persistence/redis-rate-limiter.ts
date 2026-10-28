import type { RateLimit, RateLimiter, RateLimitResult } from '../../application/ports.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import { persistenceKeys } from './keys.js';

/** `SET NX EX` and `INCR`; `@upstash/redis` and test fakes both provide them. */
export interface CounterCommands {
  incr(key: string): Promise<number>;
  set(key: string, value: string, options: { ex: number; nx: true }): Promise<unknown>;
}

const namePattern = /^[\w.:-]{1,100}$/;

/**
 * Fixed windows in Redis: one counter per name and window, created with its TTL (`SET NX EX`)
 * before it is incremented, so no counter outlives its window, even when a call fails midway.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly clock: Clock;
  private readonly keys;
  private readonly redis: CounterCommands;

  constructor(redis: CounterCommands, keyPrefix: string, clock: Clock = systemClock) {
    this.clock = clock;
    this.keys = persistenceKeys(keyPrefix);
    this.redis = redis;
  }

  async take(name: string, { limit, windowSec }: RateLimit): Promise<RateLimitResult> {
    if (!namePattern.test(name) || !Number.isInteger(windowSec) || windowSec < 1 || limit < 1) {
      throw new RangeError('Expected a short name, a window of whole seconds and a positive limit');
    }

    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    const windowStartSec = nowSec - (nowSec % windowSec);
    const retryAfterSec = windowStartSec + windowSec - nowSec;
    const key = this.keys.rateLimit(name, windowStartSec);

    await this.redis.set(key, '0', { ex: retryAfterSec + 60, nx: true });

    const count = await this.redis.incr(key);

    return count > limit ? { allowed: false, retryAfterSec } : { allowed: true };
  }
}
