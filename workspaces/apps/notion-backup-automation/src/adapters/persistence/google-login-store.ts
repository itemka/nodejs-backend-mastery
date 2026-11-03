import { createHash } from 'node:crypto';

import type { LoginRecord } from '../../oauth/records.js';
import { LOGIN_TTL_SEC, loginRecordSchema } from '../../oauth/records.js';
import { persistenceKeys } from './keys.js';

/** The commands the store needs; `@upstash/redis` and test fakes both provide them. */
export interface LoginRedis {
  /** `GETDEL`: a state is read and removed in one step, so it works once. */
  getdel(key: string): Promise<null | string>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
}

/** The SHA-256 a sign-in state is stored under. */
export function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/**
 * The phone re-login's Google sign-ins in flight (Phase 13): each state's PKCE verifier for 15
 * minutes, under the state's SHA-256, so a copy of Redis holds no state a browser could present.
 * The callback takes it with `GETDEL`, so two callbacks never share one.
 */
export class RedisLoginStore {
  private readonly keys;
  private readonly redis: LoginRedis;

  constructor(redis: LoginRedis, keyPrefix: string) {
    this.keys = persistenceKeys(keyPrefix);
    this.redis = redis;
  }

  async save(state: string, login: LoginRecord): Promise<void> {
    await this.redis.set(this.keys.googleLogin(stateHash(state)), JSON.stringify(login), {
      ex: LOGIN_TTL_SEC,
    });
  }

  /** The sign-in, once; undefined when unknown, expired, taken, or not a valid record. */
  async take(state: string): Promise<LoginRecord | undefined> {
    const raw = await this.redis.getdel(this.keys.googleLogin(stateHash(state)));

    if (raw === null) {
      return undefined;
    }

    try {
      const result = loginRecordSchema.safeParse(JSON.parse(raw));

      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  }
}
