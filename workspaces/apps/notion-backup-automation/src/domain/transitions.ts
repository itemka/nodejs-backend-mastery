import { InvalidTransitionError } from './domain-errors.js';
import type { BackupJob } from './job.js';
import type { JobStatus, Stage } from './statuses.js';
import { isTerminal, isWorkingStatus, stageOfWorkingStatus } from './statuses.js';

const workStatuses = ['TRIGGERING_EXPORT', 'WAITING_FOR_EMAIL', 'EMAIL_FOUND'] as const;

/** The forward edges of the state machine (see the plan's State Machine section). */
const forwardEdges: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  CANCELLED: [],
  COMPLETE: [],
  CREATED: ['TRIGGERING_EXPORT'],
  // Download link expired, before or during the download: a new export attempt.
  DOWNLOADING: ['VERIFYING', 'EMAIL_FOUND', 'TRIGGERING_EXPORT'],
  // Drive already holds the period's backup; or the link expired before the download.
  EMAIL_FOUND: ['DOWNLOADING', 'COMPLETE', 'TRIGGERING_EXPORT'],
  FAILED: [],
  NEEDS_ATTENTION: workStatuses,
  RETRYABLE_FAILURE: workStatuses,
  // Confirmed, already running, or in doubt; or an existing Drive backup is adopted before any export.
  TRIGGERING_EXPORT: ['WAITING_FOR_EMAIL', 'COMPLETE'],
  UPLOADING: ['COMPLETE', 'EMAIL_FOUND'],
  // An invalid ZIP is downloaded once more, then a new export attempt starts.
  VERIFYING: ['UPLOADING', 'EMAIL_FOUND', 'TRIGGERING_EXPORT'],
  // The email wait timed out with attempts left.
  WAITING_FOR_EMAIL: ['EMAIL_FOUND', 'TRIGGERING_EXPORT'],
};

/**
 * Whether `from → to` is allowed. Besides the forward edges:
 * - every working status can fail (`RETRYABLE_FAILURE`, `NEEDS_ATTENTION`);
 * - every non-terminal status can end as `CANCELLED` or `FAILED`, and can be updated in place;
 * - terminal statuses never change.
 */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (isTerminal(from)) {
    return false;
  }

  if (from === to || to === 'CANCELLED' || to === 'FAILED') {
    return true;
  }

  if (isWorkingStatus(from) && (to === 'RETRYABLE_FAILURE' || to === 'NEEDS_ATTENTION')) {
    return true;
  }

  return forwardEdges[from].includes(to);
}

/**
 * Applies a checked status change and the given field changes, and stamps `updatedAt`.
 * It also keeps two invariants:
 * - `resumeFrom` is cleared once the job is back in a working status;
 * - the incident closes when the job completes or moves to a working status of another stage.
 */
export function transition(
  job: BackupJob,
  to: JobStatus,
  changes: Partial<BackupJob>,
  now: Date,
): BackupJob {
  if (!canTransition(job.status, to)) {
    throw new InvalidTransitionError(job.status, to);
  }

  const next: BackupJob = { ...job, ...changes, status: to, updatedAt: now.toISOString() };

  if (isWorkingStatus(to)) {
    delete next.resumeFrom;
  }

  if (next.incident !== undefined && closesIncident(to, next.incident.stage)) {
    delete next.incident;
  }

  return next;
}

/** A change of fields without a change of status. */
export function update(job: BackupJob, changes: Partial<BackupJob>, now: Date): BackupJob {
  return transition(job, job.status, changes, now);
}

function closesIncident(to: JobStatus, incidentStage: Stage): boolean {
  return to === 'COMPLETE' || (isWorkingStatus(to) && stageOfWorkingStatus(to) !== incidentStage);
}
