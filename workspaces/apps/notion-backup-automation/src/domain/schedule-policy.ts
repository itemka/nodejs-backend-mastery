import type { BackupJob } from './job.js';
import { stageOf } from './job.js';
import { retryBackoffSec } from './retry-policy.js';
import { isTerminal } from './statuses.js';

const MINUTE = 60;

/** Supervisor decision wakeups are 1 min apart. */
export const SUPERVISOR_WAKEUP_DELAY_SEC = MINUTE;

/**
 * The delay before email check number `emailCheckAttempt + 1`, counted from the export request
 * or the previous check: +5 m, +15 m, then every +30 m.
 */
export function nextEmailCheckDelaySec(emailCheckAttempt: number): number {
  if (emailCheckAttempt === 0) return 5 * MINUTE;
  if (emailCheckAttempt === 1) return 15 * MINUTE;

  return 30 * MINUTE;
}

export interface WakeupHints {
  /** A `Retry-After` from the failed call, in seconds. */
  retryAfterSec?: number;
}

/**
 * When to wake the job after a tick saved it, in seconds; undefined means schedule nothing.
 * Terminal jobs and jobs waiting for a person are never polled.
 */
export function nextWakeupDelaySec(job: BackupJob, hints: WakeupHints = {}): number | undefined {
  if (isTerminal(job.status)) {
    return undefined;
  }

  switch (job.status) {
    case 'NEEDS_ATTENTION': {
      return job.incident?.state === 'awaiting_supervisor'
        ? SUPERVISOR_WAKEUP_DELAY_SEC
        : undefined;
    }

    case 'RETRYABLE_FAILURE': {
      const stage = stageOf(job);
      const retryNumber = stage === undefined ? 1 : (job.stageRetries[stage] ?? 1);

      return retryBackoffSec(retryNumber, hints.retryAfterSec);
    }

    case 'WAITING_FOR_EMAIL': {
      return nextEmailCheckDelaySec(job.emailCheckAttempt);
    }

    default: {
      return 0;
    }
  }
}
