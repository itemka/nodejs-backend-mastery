import { isLifetimeExceeded } from './job-lifecycle.js';
import type { BackupJob } from './job.js';
import type { BackupPolicy } from './policy.js';
import { isTerminal, isTransferMarker } from './statuses.js';

/** The one step a tick runs next, decided from the reloaded job while the tick holds the lease. */
export type NextStep =
  | { kind: 'await_email_in_doubt' }
  | { kind: 'begin_trigger' }
  | { kind: 'cancel' }
  | { kind: 'check_email' }
  | { kind: 'fail_lifetime' }
  | { kind: 'noop'; reason: 'awaiting_user' | 'terminal' }
  | { kind: 'resume' }
  | { kind: 'rollback_orphan' }
  | { kind: 'supervise' }
  | { kind: 'transfer' }
  | { kind: 'trigger_export' };

export type StepKind = NextStep['kind'];

/**
 * Lifetime and cancellation come first, then orphan rollback: the tick holds the lease, so a
 * progress marker it finds belongs to a worker that died.
 */
export function nextStep(job: BackupJob, now: Date, policy: BackupPolicy): NextStep {
  if (isTerminal(job.status)) {
    return { kind: 'noop', reason: 'terminal' };
  }

  if (job.cancelRequestedAt !== undefined) {
    return { kind: 'cancel' };
  }

  if (isLifetimeExceeded(job, now, policy)) {
    return { kind: 'fail_lifetime' };
  }

  if (isTransferMarker(job.status)) {
    return { kind: 'rollback_orphan' };
  }

  switch (job.status) {
    case 'CREATED': {
      return { kind: 'begin_trigger' };
    }

    case 'EMAIL_FOUND': {
      return { kind: 'transfer' };
    }

    case 'NEEDS_ATTENTION': {
      return job.incident?.state === 'awaiting_supervisor'
        ? { kind: 'supervise' }
        : { kind: 'noop', reason: 'awaiting_user' };
    }

    case 'RETRYABLE_FAILURE': {
      return { kind: 'resume' };
    }

    case 'TRIGGERING_EXPORT': {
      // Write-ahead: once the click marker is saved, this attempt never clicks again.
      return job.exportClickAt === undefined
        ? { kind: 'trigger_export' }
        : { kind: 'await_email_in_doubt' };
    }

    case 'WAITING_FOR_EMAIL': {
      return { kind: 'check_email' };
    }
  }
}

export type LeaseKind = 'heavy' | 'light';

/** A light step finishes within seconds; a heavy one may run Chromium or the transfer. */
export const LEASE_TTL_MS: Readonly<Record<LeaseKind, number>> = {
  heavy: 330_000,
  light: 60_000,
};

const stepLeases: Readonly<Record<StepKind, LeaseKind | undefined>> = {
  await_email_in_doubt: 'light',
  begin_trigger: 'light',
  cancel: 'light',
  check_email: 'light',
  fail_lifetime: 'light',
  noop: undefined,
  resume: 'light',
  rollback_orphan: 'light',
  // A supervisor action may probe the Notion session in Chromium.
  supervise: 'heavy',
  transfer: 'heavy',
  trigger_export: 'heavy',
};

/** The lease a step needs; undefined for a no-op, which needs none. */
export function leaseKindFor(step: NextStep): LeaseKind | undefined {
  return stepLeases[step.kind];
}
