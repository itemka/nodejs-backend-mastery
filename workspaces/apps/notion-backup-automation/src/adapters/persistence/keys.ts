import type { SecretName } from '../../application/ports.js';
import type { AppEnv } from '../../config/env.js';

/**
 * `{nba:<APP_ENV>}:`. The braces are a Redis hash tag: every key of one environment hashes to the
 * same slot, which multi-key Lua scripts need. `prod`, `dev` and `test` share one database.
 */
export function keyPrefixFor(appEnv: AppEnv): string {
  return `{nba:${appEnv}}:`;
}

/**
 * The key layout. A normal job's ID is its period, so `job:<period>` doubles as the
 * one-normal-job-per-period guard.
 */
export function persistenceKeys(prefix: string) {
  return {
    active: `${prefix}active`,
    email: (messageId: string) => `${prefix}email:${messageId}`,
    events: (jobId: string) => `${prefix}events:${jobId}`,
    health: `${prefix}health`,
    job: (jobId: string) => `${prefix}job:${jobId}`,
    jobs: `${prefix}jobs`,
    lease: (jobId: string) => `${prefix}lease:${jobId}`,
    /** A sent notification that must not repeat for a while: `attention:<jobId>:<code>`, `lost:<service>`. */
    notify: (key: string) => `${prefix}notify:${key}`,
    /** One MCP fixed window's counter; Telegram admission is stored by the hub. */
    rateLimit: (name: string, windowStartSec: number) =>
      `${prefix}ratelimit:${name}:${windowStartSec}`,
    secret: (name: SecretName) => `${prefix}secret:${name}`,
    telegramAction: (updateId: number) => `${prefix}telegram:action:${updateId}`,
    telegramActionIntent: (actionKey: string) => `${prefix}telegram:intent:${actionKey}`,
    /** A Cancel or Retry from scratch waiting for its second tap, for 10 minutes. */
    telegramConfirm: (nonce: string) => `${prefix}telegram:confirm:${nonce}`,
    telegramConfirmLease: (nonce: string) => `${prefix}telegram:confirm-lease:${nonce}`,
    /** A processing lease or a completed marker for one authenticated integration update. */
    telegramUpdate: (updateId: number) => `${prefix}telegram:update:${updateId}`,
  };
}

export type PersistenceKeys = ReturnType<typeof persistenceKeys>;
