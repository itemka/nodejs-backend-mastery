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
    secret: (name: SecretName) => `${prefix}secret:${name}`,
  };
}

export type PersistenceKeys = ReturnType<typeof persistenceKeys>;
