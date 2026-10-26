import { InvalidJobStateError } from './domain-errors.js';
import type { ErrorCode } from './error-catalog.js';
import { errorCatalog } from './error-catalog.js';
import type { BackupJob, BackupResult, Incident, LastError } from './job.js';
import { stageOf } from './job.js';
import type { BackupPolicy } from './policy.js';
import { MAX_TRANSFER_RUNS } from './policy.js';
import { canRetry } from './retry-policy.js';
import type { JobStatus, Stage, TransferMarker } from './statuses.js';
import { isTerminal, isTransferMarker, isWorkingStatus, stageEntryStatus } from './statuses.js';
import { transition, update } from './transitions.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * The state machine's rules, one pure function per outcome. Each takes the job and `now`, checks
 * its preconditions, and returns the next job. Persisting it (compare-and-set) is the caller's job.
 */

function requireStatus(job: BackupJob, ...allowed: JobStatus[]): void {
  if (!allowed.includes(job.status)) {
    throw new InvalidJobStateError(
      isTerminal(job.status) ? 'JOB_TERMINAL' : 'UNEXPECTED_STATUS',
      job.status,
    );
  }
}

function withoutStageRetries(job: BackupJob, stage: Stage): BackupJob['stageRetries'] {
  const { [stage]: _cleared, ...rest } = job.stageRetries;

  return rest;
}

function errorRecord(code: ErrorCode, stage: Stage, now: Date): LastError {
  return { at: now.toISOString(), code, message: errorCatalog[code].description, stage };
}

function hoursBetween(from: string, now: Date): number {
  return (now.getTime() - Date.parse(from)) / HOUR_MS;
}

/** CREATED → TRIGGERING_EXPORT. */
export function beginExportTrigger(job: BackupJob, now: Date): BackupJob {
  requireStatus(job, 'CREATED');

  return transition(job, 'TRIGGERING_EXPORT', {}, now);
}

/**
 * The write-ahead marker, saved immediately before the final Export click. Once it is saved,
 * this attempt never clicks again: a crash after it means "in doubt", which waits for the email.
 */
export function markExportClick(job: BackupJob, now: Date): BackupJob {
  requireStatus(job, 'TRIGGERING_EXPORT');

  if (job.exportClickAt !== undefined) {
    throw new InvalidJobStateError('EXPORT_ALREADY_CLICKED', job.status);
  }

  return update(job, { exportClickAt: now.toISOString() }, now);
}

/**
 * - `confirmed`: Notion showed "Exporting".
 * - `already_in_progress`: Notion reported an export already running (treated as confirmed).
 * - `in_doubt`: a worker saved `exportClickAt` and then died; the click may or may not have happened.
 */
export type ExportRequestOutcome = 'already_in_progress' | 'confirmed' | 'in_doubt';

/** TRIGGERING_EXPORT → WAITING_FOR_EMAIL. The +5 m countdown starts here. */
export function recordExportRequested(
  job: BackupJob,
  now: Date,
  outcome: ExportRequestOutcome,
): BackupJob {
  requireStatus(job, 'TRIGGERING_EXPORT');

  if (outcome !== 'already_in_progress' && job.exportClickAt === undefined) {
    throw new InvalidJobStateError('EXPORT_NOT_CLICKED', job.status);
  }

  return transition(
    job,
    'WAITING_FOR_EMAIL',
    {
      emailCheckAttempt: 0,
      requestedAt: job.exportClickAt ?? now.toISOString(),
      stageRetries: withoutStageRetries(job, 'NOTION_TRIGGER'),
    },
    now,
  );
}

/**
 * A Gmail check found no trusted email. Normally the job keeps waiting with the next check
 * counted. After `emailWaitTimeoutHours` it starts a new export attempt, or, with none left,
 * needs attention (`EMAIL_TIMEOUT`).
 */
export function recordEmailNotFound(job: BackupJob, now: Date, policy: BackupPolicy): BackupJob {
  requireStatus(job, 'WAITING_FOR_EMAIL');

  const checked = update(
    job,
    {
      emailCheckAttempt: job.emailCheckAttempt + 1,
      stageRetries: withoutStageRetries(job, 'EMAIL_WAIT'),
    },
    now,
  );

  if (hoursBetween(job.requestedAt ?? job.createdAt, now) < policy.emailWaitTimeoutHours) {
    return checked;
  }

  return checked.exportAttempt < policy.maxExportAttempts
    ? startNewExportAttempt(checked, now, policy)
    : needsAttention(checked, now, 'EMAIL_TIMEOUT');
}

export interface FoundEmail {
  messageId: string;
  receivedAt: string;
}

/** WAITING_FOR_EMAIL → EMAIL_FOUND. The caller has already claimed the email (`email:<id> NX`). */
export function recordEmailFound(job: BackupJob, now: Date, email: FoundEmail): BackupJob {
  requireStatus(job, 'WAITING_FOR_EMAIL');

  return transition(
    job,
    'EMAIL_FOUND',
    {
      emailMessageId: email.messageId,
      emailReceivedAt: email.receivedAt,
      stageRetries: withoutStageRetries(job, 'EMAIL_WAIT'),
      transferAttempt: 0,
    },
    now,
  );
}

const previousMarker: Readonly<Record<TransferMarker, JobStatus>> = {
  DOWNLOADING: 'EMAIL_FOUND',
  UPLOADING: 'VERIFYING',
  VERIFYING: 'DOWNLOADING',
};

/** EMAIL_FOUND → DOWNLOADING → VERIFYING → UPLOADING, inside one transfer invocation. */
export function markTransferProgress(job: BackupJob, now: Date, marker: TransferMarker): BackupJob {
  requireStatus(job, previousMarker[marker]);

  return transition(job, marker, {}, now);
}

function complete(job: BackupJob, now: Date, result: BackupResult): BackupJob {
  return transition(
    job,
    'COMPLETE',
    { completedAt: now.toISOString(), result, stageRetries: {} },
    now,
  );
}

/** UPLOADING → COMPLETE, once Drive's checksum matches. */
export function completeTransfer(job: BackupJob, now: Date, result: BackupResult): BackupJob {
  requireStatus(job, 'UPLOADING');

  return complete(job, now, result);
}

/**
 * Drive already holds this period's backup: before any export (Redis state lost), or before a
 * transfer → COMPLETE.
 */
export function adoptExistingBackup(job: BackupJob, now: Date, result: BackupResult): BackupJob {
  requireStatus(job, 'TRIGGERING_EXPORT', 'EMAIL_FOUND');

  return complete(job, now, result);
}

/**
 * Why a transfer run stopped without completing:
 * - `orphaned`: a progress marker was found without a live lease (the worker died);
 * - `over_budget`: the run hit its time budget and stopped;
 * - `zip_invalid`: the archive failed verification;
 * - `checksum_mismatch`: Drive's checksum did not match (the app's file was deleted).
 */
export type TransferRollbackReason =
  | 'checksum_mismatch'
  | 'orphaned'
  | 'over_budget'
  | 'zip_invalid';

const rollbackCodes: Readonly<Record<TransferRollbackReason, ErrorCode>> = {
  checksum_mismatch: 'DRIVE_CHECKSUM_MISMATCH',
  orphaned: 'TRANSFER_TIMEOUT',
  over_budget: 'TRANSFER_TIMEOUT',
  zip_invalid: 'ZIP_INVALID',
};

/**
 * The transfer is atomic from the job's point of view: a stopped run goes back to EMAIL_FOUND
 * and runs once more. After `MAX_TRANSFER_RUNS`, an invalid ZIP starts a new export attempt
 * if one is left; anything else needs attention.
 */
export function rollbackTransfer(
  job: BackupJob,
  now: Date,
  reason: TransferRollbackReason,
  policy: BackupPolicy,
): BackupJob {
  if (!isTransferMarker(job.status)) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', job.status);
  }

  const code = rollbackCodes[reason];
  const rolledBack: Partial<BackupJob> = {
    lastError: errorRecord(code, 'TRANSFER', now),
    transferAttempt: job.transferAttempt + 1,
  };

  if (job.transferAttempt + 1 < MAX_TRANSFER_RUNS) {
    return transition(job, 'EMAIL_FOUND', rolledBack, now);
  }

  if (code === 'ZIP_INVALID' && job.exportAttempt < policy.maxExportAttempts) {
    return startNewExportAttempt({ ...job, ...rolledBack }, now, policy);
  }

  return needsAttention({ ...job, ...rolledBack }, now, code);
}

/**
 * The download link expired (`expirationTimestamp` in the past), before or during the download.
 * The email is already consumed, so a new export attempt starts, or the job needs attention.
 */
export function recordLinkExpired(job: BackupJob, now: Date, policy: BackupPolicy): BackupJob {
  requireStatus(job, 'EMAIL_FOUND', 'DOWNLOADING');

  return job.exportAttempt < policy.maxExportAttempts
    ? startNewExportAttempt(job, now, policy)
    : needsAttention(job, now, 'DOWNLOAD_LINK_EXPIRED');
}

/** A fresh export attempt: → TRIGGERING_EXPORT with every per-attempt field reset. */
export function startNewExportAttempt(job: BackupJob, now: Date, policy: BackupPolicy): BackupJob {
  if (job.exportAttempt >= policy.maxExportAttempts) {
    throw new InvalidJobStateError('EXPORT_ATTEMPTS_EXHAUSTED', job.status);
  }

  return transition(
    job,
    'TRIGGERING_EXPORT',
    {
      emailCheckAttempt: 0,
      emailMessageId: undefined,
      emailReceivedAt: undefined,
      exportAttempt: job.exportAttempt + 1,
      exportClickAt: undefined,
      requestedAt: undefined,
      stageRetries: {},
      transferAttempt: 0,
    },
    now,
  );
}

/**
 * The deterministic classifier for a failed step. A retryable code with budget left goes to
 * RETRYABLE_FAILURE (the caller schedules the backoff); everything else needs attention.
 */
export function recordFailure(
  job: BackupJob,
  now: Date,
  code: ErrorCode,
  policy: BackupPolicy,
): BackupJob {
  const stage = isWorkingStatus(job.status) ? stageOf(job) : undefined;

  if (stage === undefined) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', job.status);
  }

  const retries = job.stageRetries[stage] ?? 0;

  if (!canRetry(code, retries, policy)) {
    return needsAttention(job, now, code);
  }

  return transition(
    job,
    'RETRYABLE_FAILURE',
    {
      lastError: errorRecord(code, stage, now),
      resumeFrom: stageEntryStatus[stage],
      stageRetries: { ...job.stageRetries, [stage]: retries + 1 },
    },
    now,
  );
}

/**
 * → NEEDS_ATTENTION with an incident. A supervised code waits for the supervisor; any other
 * waits for a person. The same code in the same stage reopens the incident and keeps its history.
 */
function needsAttention(job: BackupJob, now: Date, code: ErrorCode): BackupJob {
  const stage = stageOf(job);

  if (stage === undefined) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', job.status);
  }

  const previous =
    job.incident?.code === code && job.incident.stage === stage ? job.incident : undefined;
  const incident: Incident = {
    code,
    decisions: previous?.decisions ?? [],
    occurrences: (previous?.occurrences ?? 0) + 1,
    openedAt: previous?.openedAt ?? now.toISOString(),
    stage,
    state: errorCatalog[code].supervised ? 'awaiting_supervisor' : 'awaiting_user',
  };

  return transition(
    job,
    'NEEDS_ATTENTION',
    { incident, lastError: errorRecord(code, stage, now), resumeFrom: stageEntryStatus[stage] },
    now,
  );
}

/** RETRYABLE_FAILURE → `resumeFrom`, once the backoff wakeup arrives. */
export function resumeAfterBackoff(job: BackupJob, now: Date): BackupJob {
  requireStatus(job, 'RETRYABLE_FAILURE');

  if (job.resumeFrom === undefined) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', job.status);
  }

  return transition(job, job.resumeFrom, {}, now);
}

/**
 * `backup_retry`: from NEEDS_ATTENTION or RETRYABLE_FAILURE back to the entry status of
 * `fromStage` (default: the failed stage). The stage's retries reset and the incident closes.
 * A stage the job never reached cannot be retried. Retrying NOTION_TRIGGER after this attempt
 * clicked Export ("Retry from scratch") starts a new export attempt: no attempt clicks twice.
 */
export function retryJob(
  job: BackupJob,
  now: Date,
  policy: BackupPolicy,
  fromStage?: Stage,
): BackupJob {
  requireStatus(job, 'NEEDS_ATTENTION', 'RETRYABLE_FAILURE');

  const stage = fromStage ?? stageOf(job);

  if (stage === undefined) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', job.status);
  }

  const reached =
    (stage !== 'EMAIL_WAIT' || job.requestedAt !== undefined) &&
    (stage !== 'TRANSFER' || job.emailMessageId !== undefined);

  if (!reached) {
    throw new InvalidJobStateError('STAGE_NOT_REACHED', job.status);
  }

  const retried = transition(
    job,
    stageEntryStatus[stage],
    { incident: undefined, stageRetries: withoutStageRetries(job, stage) },
    now,
  );

  return stage === 'NOTION_TRIGGER' && job.exportClickAt !== undefined
    ? startNewExportAttempt(retried, now, policy)
    : retried;
}

/**
 * `retryJob` for the incident a caller read: refused (`INCIDENT_CHANGED`) once the job has
 * another incident, or another occurrence of it, so acting on an old reading never closes a
 * newer incident.
 */
export function retryIncident(
  job: BackupJob,
  now: Date,
  policy: BackupPolicy,
  incident: Incident,
): BackupJob {
  const current = job.incident;

  if (
    current?.code !== incident.code ||
    current.stage !== incident.stage ||
    current.openedAt !== incident.openedAt ||
    current.occurrences !== incident.occurrences ||
    current.state !== incident.state
  ) {
    throw new InvalidJobStateError('INCIDENT_CHANGED', job.status);
  }

  return retryJob(job, now, policy);
}

/**
 * Supervision ends without a fix (the supervisor's `notify_user`, or no supervisor at all): the
 * job stays NEEDS_ATTENTION, and its incident now waits for a person, with no wakeup.
 */
export function handOverToUser(job: BackupJob, now: Date): BackupJob {
  requireStatus(job, 'NEEDS_ATTENTION');

  if (job.incident === undefined) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', job.status);
  }

  return update(job, { incident: { ...job.incident, state: 'awaiting_user' } }, now);
}

/**
 * `backup_cancel` while a worker holds the lease: recorded now, honoured at the next step
 * boundary. Repeating it keeps the first request time.
 */
export function requestCancel(job: BackupJob, now: Date): BackupJob {
  if (isTerminal(job.status)) {
    throw new InvalidJobStateError('JOB_TERMINAL', job.status);
  }

  return job.cancelRequestedAt === undefined
    ? update(job, { cancelRequestedAt: now.toISOString() }, now)
    : job;
}

/** → CANCELLED. A Notion export already requested cannot be cancelled; its email is ignored. */
export function cancelJob(job: BackupJob, now: Date): BackupJob {
  if (isTerminal(job.status)) {
    throw new InvalidJobStateError('JOB_TERMINAL', job.status);
  }

  return transition(
    job,
    'CANCELLED',
    { cancelRequestedAt: job.cancelRequestedAt ?? now.toISOString() },
    now,
  );
}

export function isLifetimeExceeded(job: BackupJob, now: Date, policy: BackupPolicy): boolean {
  return !isTerminal(job.status) && hoursBetween(job.createdAt, now) >= policy.jobMaxLifetimeHours;
}

/** → FAILED, when the job outlives `jobMaxLifetimeHours`; the daily cron enforces it. */
export function failLifetimeExceeded(job: BackupJob, now: Date): BackupJob {
  const stage = stageOf(job);

  if (stage === undefined) {
    throw new InvalidJobStateError('JOB_TERMINAL', job.status);
  }

  return transition(
    job,
    'FAILED',
    { lastError: errorRecord('JOB_LIFETIME_EXCEEDED', stage, now) },
    now,
  );
}
