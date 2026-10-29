import type { JobStatus } from './statuses.js';

/** A status change that the state machine does not allow. Always a bug in the caller. */
export class InvalidTransitionError extends Error {
  readonly from: JobStatus;
  readonly to: JobStatus;

  constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid job transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export type InvalidJobStateReason =
  | 'EXPORT_ALREADY_CLICKED'
  | 'EXPORT_ATTEMPTS_EXHAUSTED'
  | 'EXPORT_NOT_CLICKED'
  | 'EXPORT_NOT_REQUESTED'
  | 'INCIDENT_CHANGED'
  | 'JOB_TERMINAL'
  | 'NEW_ATTEMPT_TOO_SOON'
  | 'STAGE_NOT_REACHED'
  | 'STAGE_RETRIES_EXHAUSTED'
  | 'UNEXPECTED_STATUS';

/** An operation whose preconditions do not hold for the job's current state (`INVALID_STATE`). */
export class InvalidJobStateError extends Error {
  readonly reason: InvalidJobStateReason;
  readonly status: JobStatus;

  constructor(reason: InvalidJobStateReason, status: JobStatus) {
    super(`Invalid job state for this operation: ${reason} (status ${status})`);
    this.name = 'InvalidJobStateError';
    this.reason = reason;
    this.status = status;
  }
}
