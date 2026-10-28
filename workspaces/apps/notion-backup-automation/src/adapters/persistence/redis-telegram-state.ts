import { randomUUID } from 'node:crypto';

import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import type { TelegramState } from '../../telegram/webhook.js';
import { persistenceKeys } from './keys.js';

/** Raw reads/writes and atomic Lua scripts supplied by the Redis adapter. */
export interface TelegramStateCommands {
  get(key: string): Promise<null | string>;
  eval<T>(script: string, keys: string[], args: unknown[]): Promise<T>;
  set(key: string, value: string, options: { ex: number; nx?: true }): Promise<unknown>;
}

/** Telegram resends an update for up to a day while it gets no 200; twice that is kept. */
export const UPDATE_TTL_SEC = 2 * 24 * 60 * 60;

const noncePattern = /^[\w-]{16,40}$/;

export const UPDATE_LEASE_SEC = 60;

const claimScript = `-- nba-telegram-claim
local current = redis.call('GET', KEYS[1])
if current == 'done' then return 0 end
if current then return 2 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

const completeScript = `-- nba-telegram-complete
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], 'done', 'EX', ARGV[2])
return 1`;

const releaseScript = `-- nba-telegram-release
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1`;

const claimConfirmationScript = `-- nba-confirm-claim
local pending = redis.call('GET', KEYS[1])
if not pending then return false end
if redis.call('GET', KEYS[2]) then return 'busy' end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return pending`;

const completeConfirmationScript = `-- nba-confirm-complete
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1`;

const bindActionScript = `-- nba-action-bind
local current = redis.call('GET', KEYS[1])
if current then
  if current == ARGV[1] then return 1 end
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

/** Owner-checked leases, completed action receipts and single-use confirmations. */
export class RedisTelegramState implements TelegramState {
  private readonly clock: Clock;
  private readonly keys;
  private readonly redis: TelegramStateCommands;
  private readonly claims = new Map<number, string>();
  private readonly confirmationClaims = new Map<string, string>();

  constructor(redis: TelegramStateCommands, keyPrefix: string, clock: Clock = systemClock) {
    this.clock = clock;
    this.keys = persistenceKeys(keyPrefix);
    this.redis = redis;
  }

  async claimUpdate(updateId: number): Promise<'busy' | 'claimed' | 'completed'> {
    if (!Number.isSafeInteger(updateId) || updateId < 0) {
      throw new RangeError('Expected an update ID');
    }

    const token = `${this.clock.now().toISOString()}:${randomUUID()}`;
    const result = await this.redis.eval<number>(
      claimScript,
      [this.keys.telegramUpdate(updateId)],
      [token, UPDATE_LEASE_SEC],
    );

    if (result === 1) {
      this.claims.set(updateId, token);

      return 'claimed';
    }

    return result === 0 ? 'completed' : 'busy';
  }

  async completeUpdate(updateId: number): Promise<void> {
    const token = this.claims.get(updateId);

    if (token === undefined) {
      throw new Error('Telegram update lease missing');
    }

    const result = await this.redis.eval<number>(
      completeScript,
      [this.keys.telegramUpdate(updateId)],
      [token, UPDATE_TTL_SEC],
    );

    this.claims.delete(updateId);

    if (result !== 1) {
      throw new Error('Telegram update lease expired');
    }
  }

  async readActionReceipt(updateId: number): Promise<string | undefined> {
    return (await this.redis.get(this.keys.telegramAction(updateId))) ?? undefined;
  }

  async saveActionReceipt(updateId: number, receipt: string): Promise<void> {
    await this.redis.set(this.keys.telegramAction(updateId), receipt, { ex: UPDATE_TTL_SEC });
  }

  async bindAction(actionKey: string, fingerprint: string): Promise<boolean> {
    return (
      (await this.redis.eval<number>(
        bindActionScript,
        [this.keys.telegramActionIntent(actionKey)],
        [fingerprint, UPDATE_TTL_SEC],
      )) === 1
    );
  }

  async saveConfirmation(nonce: string, value: string, ttlSec: number): Promise<void> {
    assertNonce(nonce);
    await this.redis.set(this.keys.telegramConfirm(nonce), value, { ex: ttlSec });
  }

  async releaseUpdate(updateId: number): Promise<void> {
    const token = this.claims.get(updateId);

    if (token !== undefined) {
      await this.redis.eval<number>(releaseScript, [this.keys.telegramUpdate(updateId)], [token]);
      this.claims.delete(updateId);
    }
  }

  async claimConfirmation(nonce: string): Promise<string | undefined> {
    if (!noncePattern.test(nonce)) {
      return undefined;
    }

    const token = randomUUID();
    const raw = await this.redis.eval<null | string>(
      claimConfirmationScript,
      [this.keys.telegramConfirm(nonce), this.keys.telegramConfirmLease(nonce)],
      [token, UPDATE_LEASE_SEC],
    );

    if (raw !== null && raw !== 'busy') {
      this.confirmationClaims.set(nonce, token);
    }

    return raw ?? undefined;
  }

  async completeConfirmation(nonce: string): Promise<void> {
    const token = this.confirmationClaims.get(nonce);

    if (token === undefined) {
      throw new Error('Confirmation lease missing');
    }

    const result = await this.redis.eval<number>(
      completeConfirmationScript,
      [this.keys.telegramConfirm(nonce), this.keys.telegramConfirmLease(nonce)],
      [token],
    );

    this.confirmationClaims.delete(nonce);

    if (result !== 1) {
      throw new Error('Confirmation lease expired');
    }
  }

  async releaseConfirmation(nonce: string): Promise<void> {
    const token = this.confirmationClaims.get(nonce);

    if (token !== undefined) {
      await this.redis.eval<number>(
        releaseScript,
        [this.keys.telegramConfirmLease(nonce)],
        [token],
      );
      this.confirmationClaims.delete(nonce);
    }
  }
}

function assertNonce(nonce: string): void {
  if (!noncePattern.test(nonce)) {
    throw new RangeError('Expected a nonce of 16 to 40 URL-safe characters');
  }
}
