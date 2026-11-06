import { sanitizeLandmarks } from '../../agent/sanitize.js';
import type { Supervisor } from '../../agent/supervisor.js';
import { InvalidJobStateError } from '../../domain/domain-errors.js';
import type { ErrorCode } from '../../domain/error-catalog.js';
import type { FailureObservations } from '../../domain/job-lifecycle.js';
import { recordFailure } from '../../domain/job-lifecycle.js';
import type { BackupJob } from '../../domain/job.js';
import type { BackupPolicy } from '../../domain/policy.js';
import { abortable } from '../../shared/abortable.js';
import type { Clock } from '../../shared/clock.js';
import type { Logger } from '../../shared/logger.js';
import { IntegrationError } from '../integration-error.js';
import type { JobStore } from '../job-store.js';
import { JobConflictError } from '../job-store.js';
import type {
  BackupStorage,
  ExportEmailFinder,
  ExportTransfer,
  HealthStore,
  JobRepository,
  NotionExportTrigger,
  StoredJob,
} from '../ports.js';

/** The ports and settings the steps use; `ProcessJobOptions` adds what only the tick needs. */
export interface StepDependencies {
  readonly clock: Clock;
  readonly emails: ExportEmailFinder;
  /** `EXPORT_SHRINK_RATIO`. */
  readonly exportShrinkRatio: number;
  /** The probe results `inspect_status` adds to the supervisor's context. */
  readonly health: Pick<HealthStore, 'read'>;
  readonly jobs: JobRepository;
  readonly logger: Logger;
  readonly policy: BackupPolicy;
  readonly storage: Pick<BackupStorage, 'findExisting'>;
  /** Decides on incidents that wait for the supervisor (`NoopAgentModel` without an LLM). */
  readonly supervisor: Supervisor;
  /** `BACKUP_TIME_ZONE`: dates the backup's file name. */
  readonly timeZone: string;
  readonly transfer: ExportTransfer;
  readonly trigger: Pick<NotionExportTrigger, 'probeSession' | 'requestExport'>;
}

/** One step's run: the dependencies, the job store, the tick's logger and the step's budget. */
export interface StepContext extends StepDependencies {
  /** The tick's logger, with its job and tick ids. */
  readonly log: Logger;
  /** Aborts once the step's time budget runs out. */
  readonly signal: AbortSignal;
  readonly store: JobStore;
}

export interface StepResult {
  /** The supervisor's own wakeup (`wait`, or the minute between decisions). */
  readonly delaySec?: number;
  /** A `Retry-After` from the failed call, for the backoff. */
  readonly retryAfterSec?: number | undefined;
  readonly stored: StoredJob;
}

/** One step kind's work on the reloaded job. */
export type Step = (ctx: StepContext, current: StoredJob) => Promise<StepResult>;

/** A pure lifecycle rule, applied at the time of the write; `policy` for the rules that need it. */
export type JobRule = (job: BackupJob, now: Date, policy: BackupPolicy) => BackupJob;

/** A port call failed with a cataloged code: the job records it. */
export class StepFailure extends Error {
  readonly code: ErrorCode;
  readonly observed: FailureObservations;
  readonly retryAfterSec: number | undefined;

  constructor(code: ErrorCode, retryAfterSec?: number, observed: FailureObservations = {}) {
    super(code);
    this.name = 'StepFailure';
    this.code = code;
    this.observed = observed;
    this.retryAfterSec = retryAfterSec;
  }
}

/** The step's own callback failed (a job write); it passes through the port call unchanged. */
class CallbackFailure extends Error {
  readonly failure: unknown;

  constructor(failure: unknown) {
    super('A job write inside the step failed');
    this.name = 'CallbackFailure';
    this.failure = failure;
  }
}

/** A cancel request arrived during the step: no more work starts, and the next tick cancels. */
export class CancelRequested extends Error {
  constructor() {
    super('Cancel requested');
    this.name = 'CancelRequested';
  }
}

/** Errors after which the step stops safely: the stored state stays as it is, and is re-evaluated. */
export function isSafeStop(error: unknown): boolean {
  return (
    error instanceof CancelRequested ||
    error instanceof InvalidJobStateError ||
    error instanceof JobConflictError
  );
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/** Wraps a callback the port runs mid-call, so its failure is not taken for the port's own. */
export async function guarded(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw new CallbackFailure(error);
  }
}

/** Saves `rule` applied to the stored job; on a version conflict, to the reloaded one. */
export function commitRule(
  ctx: StepContext,
  current: StoredJob,
  rule: JobRule,
  detail?: string,
): Promise<StoredJob> {
  return ctx.store.commit(current, (job) => rule(job, ctx.clock.now(), ctx.policy), detail);
}

/** A step that only applies one lifecycle rule. */
export function commitStep(rule: JobRule, detail?: string): Step {
  return async (ctx, current) => ({ stored: await commitRule(ctx, current, rule, detail) });
}

/**
 * Runs a port call within the step's budget. Its failures become a `StepFailure`: the
 * cataloged code, `timeoutCode` once the budget ran out, or `UNKNOWN_ERROR`. A failure of the
 * step's own callback passes through unchanged.
 */
export async function callPort<T>(
  ctx: StepContext,
  call: () => Promise<T>,
  timeoutCode: ErrorCode,
): Promise<T> {
  const { log, signal } = ctx;

  try {
    return await abortable(call(), signal);
  } catch (error) {
    if (error instanceof CallbackFailure) {
      throw error;
    }

    if (error instanceof IntegrationError) {
      throw new StepFailure(
        error.code,
        error.retryAfterSec,
        error.uiLandmarks === undefined
          ? {}
          : { uiLandmarks: sanitizeLandmarks(error.uiLandmarks) },
      );
    }

    if (signal.aborted) {
      log.warn('job.step.over_budget', { code: timeoutCode });

      throw new StepFailure(timeoutCode);
    }

    log.error('job.step.unexpected', { error });

    throw new StepFailure('UNKNOWN_ERROR');
  }
}

/** The cataloged code a port call failed with; undefined when it succeeded. */
export async function failureCode(
  ctx: StepContext,
  call: () => Promise<unknown>,
  timeoutCode: ErrorCode,
): Promise<ErrorCode | undefined> {
  try {
    await callPort(ctx, call, timeoutCode);

    return undefined;
  } catch (error) {
    if (error instanceof StepFailure) {
      return error.code;
    }

    throw error;
  }
}

/**
 * A port failure is recorded; a safe stop keeps the stored state; anything else (Redis) is
 * thrown, so QStash retries the delivery.
 */
export async function onStepError(
  ctx: StepContext,
  error: unknown,
  latest: StoredJob,
  record: (failure: StepFailure) => Promise<StepResult>,
): Promise<StepResult> {
  if (error instanceof StepFailure) {
    ctx.log.warn('job.step.failed', { code: error.code });

    return record(error);
  }

  const cause = error instanceof CallbackFailure ? error.failure : error;

  if (!isSafeStop(cause)) {
    throw cause;
  }

  ctx.log.info('job.step.stopped', { reason: errorName(cause) });

  return { stored: (await ctx.jobs.get(latest.job.id)) ?? latest };
}

/** Records the failure on the job, with the call's `Retry-After` for the backoff. */
export async function saveFailure(
  ctx: StepContext,
  latest: StoredJob,
  failure: StepFailure,
): Promise<StepResult> {
  return {
    retryAfterSec: failure.retryAfterSec,
    stored: await commitRule(ctx, latest, (job, now, policy) =>
      recordFailure(job, now, failure.code, policy, failure.observed),
    ),
  };
}
