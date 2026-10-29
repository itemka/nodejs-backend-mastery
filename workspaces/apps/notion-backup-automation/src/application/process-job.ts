import { INSPECTED_EVENT_COUNT } from '../agent/context-builder.js';
import { sanitizeLandmarks } from '../agent/sanitize.js';
import type { SupervisorPlan } from '../agent/supervisor.js';
import { Supervisor } from '../agent/supervisor.js';
import { InvalidJobStateError } from '../domain/domain-errors.js';
import type { ErrorCode } from '../domain/error-catalog.js';
import { errorCatalog } from '../domain/error-catalog.js';
import { compareWithPrevious } from '../domain/export-size.js';
import type { JobEvent } from '../domain/job-event.js';
import type { FailureObservations, TransferRollbackReason } from '../domain/job-lifecycle.js';
import {
  adoptExistingBackup,
  beginExportTrigger,
  cancelJob,
  completeTransfer,
  failLifetimeExceeded,
  handOverToUser,
  markExportClick,
  markTransferProgress,
  recordEmailFound,
  recordEmailNotFound,
  recordExportRequested,
  recordFailure,
  recordLinkExpired,
  recordSupervisorDecision,
  replaceIncident,
  resumeAfterBackoff,
  rollbackTransfer,
  supervisorNewAttempt,
  supervisorRetryStage,
} from '../domain/job-lifecycle.js';
import type {
  BackupJob,
  BackupResult,
  Incident,
  IncidentDecision,
  SupervisorObservations,
} from '../domain/job.js';
import { backupFileName } from '../domain/naming.js';
import type { LeaseKind, NextStep, StepKind } from '../domain/next-step.js';
import { LEASE_TTL_MS, leaseKindFor, nextStep } from '../domain/next-step.js';
import { localDateFor } from '../domain/period.js';
import type { BackupPolicy } from '../domain/policy.js';
import { nextWakeupDelaySec } from '../domain/schedule-policy.js';
import type { JobStatus } from '../domain/statuses.js';
import { isTerminal, isTransferMarker } from '../domain/statuses.js';
import { update } from '../domain/transitions.js';
import { abortable } from '../shared/abortable.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import type { HealthSnapshot } from './health-snapshot.js';
import { IntegrationError } from './integration-error.js';
import type { JobNotifications } from './job-notifications.js';
import { JobConflictError, JobStore } from './job-store.js';
import { describeSize } from './notification-text.js';
import type {
  BackupStorage,
  ExportEmailFinder,
  ExportEmailSearchResult,
  ExportTransfer,
  HealthStore,
  JobRepository,
  NotionExportTrigger,
  Scheduler,
  StoredJob,
  WakeupReason,
} from './ports.js';

/**
 * How long a step may start new work: a heavy one stops at 270 s, inside the 300 s function
 * limit and the 330 s lease; a light one well inside its 60 s lease.
 */
export const STEP_BUDGET_MS: Readonly<Record<LeaseKind, number>> = {
  heavy: 270_000,
  light: 45_000,
};

/** The jobs scanned for the export size check's baseline, newest first. */
const BASELINE_SCAN_LIMIT = 24;

/** Emails another job owns are skipped; after this many, the check counts as "no email yet". */
const MAX_EMAIL_CLAIMS = 3;

const transferRollbacks: Readonly<Partial<Record<ErrorCode, TransferRollbackReason>>> = {
  DRIVE_CHECKSUM_MISMATCH: 'checksum_mismatch',
  TRANSFER_TIMEOUT: 'over_budget',
  ZIP_INVALID: 'zip_invalid',
};

/** One QStash delivery: the job and the schedule token it carries. */
export interface TickRequest {
  readonly jobId: string;
  readonly reason: WakeupReason;
  readonly token: string;
}

/**
 * - `done`: one step ran (or none was due) and the next wakeup, if any, is published;
 * - `stale`: the token is no longer the job's, so the delivery does nothing;
 * - `lease_held`: another worker runs the job; retry after `retryAfterSec`;
 * - `terminal`: the job has ended; `not_found`: no such job.
 *
 * Redis or a publish failing throws, so QStash retries the delivery with the same token.
 */
export type TickResult =
  | {
      readonly nextWakeupSec?: number;
      readonly outcome: 'done';
      readonly status: JobStatus;
      readonly step: StepKind;
    }
  | { readonly outcome: 'lease_held'; readonly retryAfterSec: number }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'terminal'; readonly status: JobStatus };

export interface ProcessJobOptions {
  readonly budgetsMs?: Readonly<Record<LeaseKind, number>>;
  readonly clock: Clock;
  readonly emails: ExportEmailFinder;
  /** `EXPORT_SHRINK_RATIO`. */
  readonly exportShrinkRatio: number;
  /** The probe results `inspect_status` adds to the supervisor's context. */
  readonly health: Pick<HealthStore, 'read'>;
  readonly ids: IdGenerator;
  readonly jobs: JobRepository;
  readonly logger: Logger;
  readonly notifications: Pick<JobNotifications, 'attention' | 'failure' | 'success'>;
  readonly policy: BackupPolicy;
  readonly scheduler: Scheduler;
  readonly storage: Pick<BackupStorage, 'findExisting'>;
  /** Decides on incidents that wait for the supervisor (`NoopAgentModel` without an LLM). */
  readonly supervisor: Supervisor;
  /** `BACKUP_TIME_ZONE`: dates the backup's file name. */
  readonly timeZone: string;
  readonly transfer: ExportTransfer;
  readonly trigger: Pick<NotionExportTrigger, 'probeSession' | 'requestExport'>;
}

interface StepResult {
  /** The supervisor's own wakeup (`wait`, or the minute between decisions). */
  readonly delaySec?: number;
  /** A `Retry-After` from the failed call, for the backoff. */
  readonly retryAfterSec?: number | undefined;
  readonly stored: StoredJob;
}

/** A port call failed with a cataloged code: the job records it. */
class StepFailure extends Error {
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

type ActPlan = Extract<SupervisorPlan, { kind: 'act' }>;

/** What a supervisor action did: the decision's outcome, its observations, and the job rule. */
interface ActionEffect {
  readonly delaySec?: number;
  /** The transition's event detail, when the rule changes the status. */
  readonly detail?: string;
  readonly observations?: SupervisorObservations;
  readonly outcome: string;
  readonly apply?: (job: BackupJob, now: Date) => BackupJob;
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
class CancelRequested extends Error {
  constructor() {
    super('Cancel requested');
    this.name = 'CancelRequested';
  }
}

/** Errors after which the step stops safely: the stored state stays as it is, and is re-evaluated. */
function isSafeStop(error: unknown): boolean {
  return (
    error instanceof CancelRequested ||
    error instanceof InvalidJobStateError ||
    error instanceof JobConflictError
  );
}

async function guarded(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw new CallbackFailure(error);
  }
}

/**
 * One tick of one job (`ProcessJobUseCase.execute`): load, lease, reload, check the token, run
 * exactly one step with compare-and-set transitions, notify, then publish the next wakeup and
 * save its token. The lease is released whatever happens.
 */
export class ProcessJobUseCase {
  private readonly budgetsMs: Readonly<Record<LeaseKind, number>>;
  private readonly clock: Clock;
  private readonly emails: ExportEmailFinder;
  private readonly exportShrinkRatio: number;
  private readonly health: Pick<HealthStore, 'read'>;
  private readonly ids: IdGenerator;
  private readonly jobs: JobRepository;
  private readonly logger: Logger;
  private readonly notifications: Pick<JobNotifications, 'attention' | 'failure' | 'success'>;
  private readonly policy: BackupPolicy;
  private readonly scheduler: Scheduler;
  private readonly storage: Pick<BackupStorage, 'findExisting'>;
  private readonly store: JobStore;
  private readonly supervisor: Supervisor;
  private readonly timeZone: string;
  private readonly transfer: ExportTransfer;
  private readonly trigger: Pick<NotionExportTrigger, 'probeSession' | 'requestExport'>;

  constructor(options: ProcessJobOptions) {
    this.budgetsMs = options.budgetsMs ?? STEP_BUDGET_MS;
    this.clock = options.clock;
    this.emails = options.emails;
    this.exportShrinkRatio = options.exportShrinkRatio;
    this.health = options.health;
    this.ids = options.ids;
    this.jobs = options.jobs;
    this.logger = options.logger;
    this.notifications = options.notifications;
    this.policy = options.policy;
    this.scheduler = options.scheduler;
    this.storage = options.storage;
    this.store = new JobStore({ clock: options.clock, jobs: options.jobs, logger: options.logger });
    this.supervisor = options.supervisor;
    this.timeZone = options.timeZone;
    this.transfer = options.transfer;
    this.trigger = options.trigger;
  }

  async execute(request: TickRequest): Promise<TickResult> {
    const log = this.logger.child({ jobId: request.jobId, tickId: this.ids.shortId() });
    const first = await this.jobs.get(request.jobId);

    if (first === undefined) {
      return { outcome: 'not_found' };
    }

    if (isTerminal(first.job.status)) {
      // A worker that died between saving the end and notifying left it unsent; it is sent once.
      await this.notify(first.job);

      return { outcome: 'terminal', status: first.job.status };
    }

    const planned = nextStep(first.job, this.clock.now(), this.policy);
    const plannedLease = leaseKindFor(planned);

    // A job waiting for a person needs no lease. A token that does not match may belong to a
    // wakeup whose save is still in flight under a lease, so it is checked under the lease.
    if (plannedLease === undefined && isCurrent(first.job, request.token)) {
      log.info('job.tick.noop', { reason: request.reason, status: first.job.status });
      // The token is still current only if the worker died before notifying and clearing it;
      // the attention gate keeps this to one message.
      await this.notify(first.job);

      return { outcome: 'done', status: first.job.status, step: planned.kind };
    }

    const lease = plannedLease ?? 'light';
    const workerId = this.ids.shortId();
    const acquired = await this.jobs.acquireLease(request.jobId, workerId, LEASE_TTL_MS[lease]);

    if (!acquired.acquired) {
      log.info('job.tick.lease_held', { remainingMs: acquired.remainingMs });

      return {
        outcome: 'lease_held',
        retryAfterSec: Math.max(1, Math.ceil(acquired.remainingMs / 1000)),
      };
    }

    try {
      return await this.runLeased(request, lease, log);
    } finally {
      try {
        await this.jobs.releaseLease(request.jobId, workerId);
      } catch (error) {
        log.warn('job.lease.release_failed', { error });
      }
    }
  }

  private async runLeased(
    request: TickRequest,
    lease: LeaseKind,
    log: Logger,
  ): Promise<TickResult> {
    const current = await this.jobs.get(request.jobId);

    if (current === undefined) {
      return { outcome: 'not_found' };
    }

    if (isTerminal(current.job.status)) {
      return { outcome: 'terminal', status: current.job.status };
    }

    if (!isCurrent(current.job, request.token)) {
      log.info('job.tick.stale', { reason: request.reason });

      return { outcome: 'stale' };
    }

    const step = nextStep(current.job, this.clock.now(), this.policy);
    const needed = leaseKindFor(step);

    if (needed === 'heavy' && lease === 'light') {
      // The job changed between the two reads; QStash delivers again under the right lease.
      return { outcome: 'lease_held', retryAfterSec: 1 };
    }

    if (needed === undefined) {
      return { outcome: 'done', status: current.job.status, step: step.kind };
    }

    log.info('job.step.start', {
      reason: request.reason,
      status: current.job.status,
      step: step.kind,
    });

    let result: StepResult;

    try {
      result = await this.runStep(step, current, AbortSignal.timeout(this.budgetsMs[needed]), log);
    } catch (error) {
      if (!isSafeStop(error)) {
        throw error;
      }

      log.info('job.step.stopped', { reason: errorName(error) });
      result = { stored: (await this.jobs.get(current.job.id)) ?? current };
    }

    await this.notify(result.stored.job);

    const scheduled = await this.scheduleNext(result, log);
    const { status } = scheduled.stored.job;

    log.info('job.step.done', {
      nextWakeupSec: scheduled.delaySec,
      status,
      step: step.kind,
    });

    return {
      outcome: 'done',
      status,
      step: step.kind,
      ...(scheduled.delaySec === undefined ? {} : { nextWakeupSec: scheduled.delaySec }),
    };
  }

  private async runStep(
    step: NextStep,
    current: StoredJob,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StepResult> {
    const commit = async (rule: (job: BackupJob, now: Date) => BackupJob, detail?: string) => ({
      stored: await this.store.commit(current, (job) => rule(job, this.clock.now()), detail),
    });

    switch (step.kind) {
      case 'await_email_in_doubt': {
        return commit((job, now) => recordExportRequested(job, now, 'in_doubt'), 'in doubt');
      }

      case 'begin_trigger': {
        return commit(beginExportTrigger);
      }

      case 'cancel': {
        return commit(cancelJob);
      }

      case 'check_email': {
        return this.checkEmail(current, signal, log);
      }

      case 'fail_lifetime': {
        return commit(failLifetimeExceeded);
      }

      case 'noop': {
        return { stored: current };
      }

      case 'resume': {
        return commit(resumeAfterBackoff);
      }

      case 'rollback_orphan': {
        return commit(
          (job, now) => rollbackTransfer(job, now, 'orphaned', this.policy),
          'orphaned',
        );
      }

      case 'supervise': {
        return this.supervise(current, signal, log);
      }

      case 'transfer': {
        return this.transferExport(current, signal, log);
      }

      case 'trigger_export': {
        return this.triggerExport(current, signal, log);
      }
    }
  }

  /**
   * Drive first: an existing backup of the period is adopted (the Redis-loss guard). Then the
   * export, with the write-ahead click marker saved just before the final click.
   */
  private async triggerExport(
    current: StoredJob,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StepResult> {
    let latest = current;

    try {
      const adopted = await this.adoptStoredBackup(latest, signal, log);

      if (adopted !== undefined) {
        return { stored: adopted };
      }

      const { outcome } = await this.callPort(
        () =>
          this.trigger.requestExport({
            onBeforeFinalClick: () =>
              guarded(async () => {
                latest = await this.store.commit(latest, (job) => {
                  if (job.cancelRequestedAt !== undefined) {
                    throw new CancelRequested();
                  }

                  return markExportClick(job, this.clock.now());
                });
                await this.store.note(
                  latest.job.id,
                  'export.click · marker saved, clicking Export',
                );
              }),
            signal,
          }),
        signal,
        'NOTION_UNAVAILABLE',
        log,
      );

      return {
        stored: await this.store.commit(
          latest,
          (job) => recordExportRequested(job, this.clock.now(), outcome),
          outcome.replaceAll('_', ' '),
        ),
      };
    } catch (error) {
      return this.onStepError(error, latest, log, (failure) => this.saveFailure(latest, failure));
    }
  }

  /** The newest trusted export email the job can claim; one owned by another job is skipped. */
  private async checkEmail(
    current: StoredJob,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StepResult> {
    const { job } = current;
    const requestedAfter = new Date(job.requestedAt ?? job.createdAt);
    const excludeIds: string[] = [];

    try {
      for (let claims = 0; claims < MAX_EMAIL_CLAIMS; claims += 1) {
        const search = await this.callPort(
          () => this.emails.findReadyEmail({ excludeIds, requestedAfter }),
          signal,
          'GMAIL_UNAVAILABLE',
          log,
        );

        if (search.status === 'not_found') {
          break;
        }

        const { ownerJobId } = await this.jobs.markEmailConsumed(search.email.messageId, job.id);

        if (ownerJobId === job.id) {
          return {
            stored: await this.store.commit(current, (latest) =>
              recordEmailFound(latest, this.clock.now(), search.email),
            ),
          };
        }

        excludeIds.push(search.email.messageId);
        await this.store.note(
          job.id,
          `email.skipped · email ${search.email.messageId} belongs to job ${ownerJobId}`,
        );
      }

      return {
        stored: await this.store.commit(current, (latest) =>
          recordEmailNotFound(latest, this.clock.now(), this.policy),
        ),
      };
    } catch (error) {
      return this.onStepError(error, current, log, (failure) => this.saveFailure(current, failure));
    }
  }

  /**
   * Drive first, then the transfer in one invocation; each progress marker is saved before its
   * work starts. A stopped run rolls back to EMAIL_FOUND (or a new attempt) per the domain rules.
   */
  private async transferExport(
    current: StoredJob,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StepResult> {
    let latest = current;

    try {
      const adopted = await this.adoptStoredBackup(latest, signal, log);

      if (adopted !== undefined) {
        return { stored: adopted };
      }

      const { emailMessageId, id, period, requestedAt } = latest.job;

      if (emailMessageId === undefined || requestedAt === undefined) {
        throw new InvalidJobStateError('UNEXPECTED_STATUS', latest.job.status);
      }

      const result = await this.callPort(
        () =>
          this.transfer.run({
            emailMessageId,
            fileName: backupFileName(localDateFor(new Date(requestedAt), this.timeZone)),
            jobId: id,
            onStep: (marker) =>
              guarded(async () => {
                latest = await this.store.commit(latest, (job) => {
                  if (job.cancelRequestedAt !== undefined) {
                    throw new CancelRequested();
                  }

                  return markTransferProgress(job, this.clock.now(), marker);
                });
              }),
            period,
            signal,
          }),
        signal,
        'TRANSFER_TIMEOUT',
        log,
      );

      if (result.outcome === 'link_expired') {
        return {
          stored: await this.store.commit(
            latest,
            (job) => recordLinkExpired(job, this.clock.now(), this.policy),
            'link expired',
          ),
        };
      }

      const { backup, entryCount } = result;
      const checked = await this.checkExportSize(latest.job, {
        driveFileId: backup.driveFileId,
        entryCount,
        fileName: backup.fileName,
        sha256: backup.sha256,
        sizeBytes: backup.sizeBytes,
        yearFolderId: backup.yearFolderId,
      });
      const stored = await this.store.commit(
        latest,
        (job) => completeTransfer(job, this.clock.now(), checked.result),
        backup.uploaded ? 'uploaded' : 'already in Drive',
      );

      await this.store.note(id, checked.note);

      if (backup.leftoverFileId !== undefined) {
        await this.store.note(
          id,
          `drive.duplicate_kept · Drive kept duplicate file ${backup.leftoverFileId}; delete it in Drive`,
        );
      }

      if (backup.sidecar === 'failed') {
        await this.store.note(id, 'drive.sidecar_failed · the .sha256 sidecar was not written');
      }

      return { stored };
    } catch (error) {
      return this.onStepError(error, latest, log, (failure) =>
        this.transferFailure(latest, failure),
      );
    }
  }

  /** An invalid ZIP, a checksum mismatch or the time budget roll the transfer back; anything else is a failure. */
  private async transferFailure(latest: StoredJob, failure: StepFailure): Promise<StepResult> {
    const reason = transferRollbacks[failure.code];

    if (reason === undefined || !isTransferMarker(latest.job.status)) {
      return this.saveFailure(latest, failure);
    }

    return {
      stored: await this.store.commit(
        latest,
        (job) => rollbackTransfer(job, this.clock.now(), reason, this.policy),
        reason.replaceAll('_', ' '),
      ),
    };
  }

  /** A verified backup of the period already in Drive completes the job without an export. */
  private async adoptStoredBackup(
    current: StoredJob,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StoredJob | undefined> {
    const { job } = current;
    // A forced job must not adopt the period's normal backup: it was forced to make a new one.
    const existing = await this.callPort(
      () =>
        this.storage.findExisting(
          { period: job.period, ...(job.kind === 'forced' ? { jobId: job.id } : {}) },
          signal,
        ),
      signal,
      'DRIVE_UNAVAILABLE',
      log,
    );

    if (existing === undefined) {
      return undefined;
    }

    const checked = await this.checkExportSize(job, {
      driveFileId: existing.driveFileId,
      fileName: existing.fileName,
      sha256: existing.sha256,
      sizeBytes: existing.sizeBytes,
      yearFolderId: existing.yearFolderId,
    });
    const stored = await this.store.commit(
      current,
      (latest) => adoptExistingBackup(latest, this.clock.now(), checked.result),
      'adopted from Drive',
    );

    await this.store.note(
      job.id,
      `backup.adopted · Drive already holds a verified backup of ${job.period}: ${existing.fileName}, from job ${existing.jobId}`,
    );
    await this.store.note(job.id, checked.note);

    return stored;
  }

  /**
   * The export size check, at the transition to COMPLETE: the newest earlier COMPLETE job is the
   * baseline. A shrunk backup still completes; its result records the shrink.
   */
  private async checkExportSize(
    job: BackupJob,
    result: BackupResult,
  ): Promise<{ note: string; result: BackupResult }> {
    let recent: StoredJob[];

    try {
      recent = await this.jobs.list({ limit: BASELINE_SCAN_LIMIT });
    } catch (error) {
      // The check never blocks a backup: an unreadable earlier job only skips it.
      this.logger.warn('export.size.failed', { error, jobId: job.id });

      return { note: 'export.size · earlier jobs could not be read; not compared', result };
    }

    const previous = recent
      .map((stored) => stored.job)
      .find((other) => other.id !== job.id && other.status === 'COMPLETE');

    if (previous?.result === undefined) {
      return { note: 'export.size · no earlier backup to compare with', result };
    }

    const shrink = compareWithPrevious(
      result,
      {
        jobId: previous.id,
        sizeBytes: previous.result.sizeBytes,
        ...(previous.result.entryCount === undefined
          ? {}
          : { entryCount: previous.result.entryCount }),
      },
      this.exportShrinkRatio,
    );
    const comparison = `${describeSize(result)}; last backup (${previous.id}) had ${describeSize(previous.result)}`;

    return shrink === undefined
      ? { note: `export.size · ${comparison}`, result }
      : { note: `export.shrunk · ${comparison}`, result: { ...result, shrink } };
  }

  private async saveFailure(latest: StoredJob, failure: StepFailure): Promise<StepResult> {
    return {
      retryAfterSec: failure.retryAfterSec,
      stored: await this.store.commit(latest, (job) =>
        recordFailure(job, this.clock.now(), failure.code, this.policy, failure.observed),
      ),
    };
  }

  /**
   * One supervisor decision on the pending incident (the plan's LLM Supervisor loop): the plan,
   * then exactly one action, saved with the decision and what the action observed. The next
   * tick re-evaluates the deterministic state first.
   */
  private async supervise(
    current: StoredJob,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StepResult> {
    const { incident } = current.job;

    if (incident === undefined) {
      throw new InvalidJobStateError('UNEXPECTED_STATUS', current.job.status);
    }

    const inspected = Supervisor.needsInspection(current.job)
      ? await this.inspection(current.job.id, log)
      : undefined;
    const plan = await this.supervisor.plan(current.job, inspected, signal);

    switch (plan.kind) {
      case 'too_soon': {
        return { delaySec: plan.waitSec, stored: current };
      }

      case 'model_failed': {
        const stored = await this.commitDecision(current, incident, {
          decision: { modelFailure: plan.failure, outcome: 'no_decision' },
        });

        await this.store.supervisor(
          current.job.id,
          `supervisor · no decision: the model (${this.supervisor.modelId}) failed with ${plan.failure}`,
          incident.code,
        );

        return { stored };
      }

      case 'act': {
        return this.act(current, incident, plan, signal, log);
      }
    }
  }

  /** Runs the planned action's effect, then saves the decision and the job rule in one write. */
  private async act(
    current: StoredJob,
    incident: Incident,
    plan: ActPlan,
    signal: AbortSignal,
    log: Logger,
  ): Promise<StepResult> {
    const effect = await this.actionEffect(current.job, plan, signal, log);
    const waitUntil =
      effect.delaySec === undefined
        ? undefined
        : new Date(this.clock.now().getTime() + effect.delaySec * 1000).toISOString();
    const stored = await this.commitDecision(current, incident, {
      decision: {
        action: plan.action.action,
        outcome: effect.outcome,
        ...(plan.modelFailure === undefined ? {} : { modelFailure: plan.modelFailure }),
        ...(waitUntil === undefined ? {} : { waitUntil }),
      },
      ...(effect.detail === undefined ? {} : { detail: effect.detail }),
      ...(effect.observations === undefined ? {} : { observations: effect.observations }),
      ...(effect.apply === undefined ? {} : { apply: effect.apply }),
    });

    await this.store.supervisor(
      current.job.id,
      supervisorEventText(plan, effect, this.supervisor.modelId),
      incident.code,
    );

    return { stored, ...(effect.delaySec === undefined ? {} : { delaySec: effect.delaySec }) };
  }

  private async actionEffect(
    job: BackupJob,
    plan: ActPlan,
    signal: AbortSignal,
    log: Logger,
  ): Promise<ActionEffect> {
    const { action } = plan;
    const at = this.clock.now().toISOString();

    switch (action.action) {
      case 'check_notion_session': {
        const code = await this.failureCode(
          () => this.trigger.probeSession(signal),
          signal,
          'NOTION_UNAVAILABLE',
          log,
        );
        const state = notionStateFor(code);

        return {
          observations: { notionSession: { checkedAt: at, state } },
          outcome: `session:${state}`,
          ...replacedBy(code),
        };
      }

      case 'inspect_status': {
        return { observations: { inspectedAt: at }, outcome: 'inspected' };
      }

      case 'notify_user': {
        const { summary } = action;

        return {
          apply: (latest, now) => handOverToUser(latest, now, summary),
          outcome: plan.forced === undefined ? 'handed_over' : `forced:${plan.forced}`,
        };
      }

      case 'retry': {
        return {
          apply: (latest, now) => supervisorNewAttempt(latest, now, this.policy),
          detail: 'supervisor retry',
          outcome: 'new_attempt',
        };
      }

      case 'retry_stage': {
        return {
          apply: (latest, now) => supervisorRetryStage(latest, now, this.policy),
          detail: 'supervisor retry_stage',
          outcome: 'retrying',
        };
      }

      case 'search_email_again': {
        return this.searchEmailAgain(job, action.widenMinutes, at, signal, log);
      }

      case 'wait': {
        return { delaySec: action.minutes * 60, outcome: `wait:${action.minutes}m` };
      }
    }
  }

  /** The Gmail match again, from `widenMinutes` earlier; only counts and reasons are kept. */
  private async searchEmailAgain(
    job: BackupJob,
    widenMinutes: 60 | 180,
    at: string,
    signal: AbortSignal,
    log: Logger,
  ): Promise<ActionEffect> {
    const requestedAt = Date.parse(job.requestedAt ?? job.createdAt);
    const requestedAfter = new Date(requestedAt - widenMinutes * 60_000);
    let result: ExportEmailSearchResult | undefined;
    const code = await this.failureCode(
      async () => {
        result = await this.emails.findReadyEmail({ excludeIds: [], requestedAfter });
      },
      signal,
      'GMAIL_UNAVAILABLE',
      log,
    );

    if (result === undefined) {
      const failed = code ?? 'UNKNOWN_ERROR';

      return {
        observations: {
          emailSearch: { at, candidates: 0, code: failed, rejected: {}, widenMinutes },
        },
        outcome: `search_failed:${failed}`,
        ...replacedBy(failed),
      };
    }

    const found = result.status === 'found';

    return {
      observations: {
        emailSearch: {
          at,
          candidates: found ? 1 : 0,
          rejected: result.status === 'found' ? {} : { ...result.rejected },
          widenMinutes,
        },
      },
      outcome: found ? 'email_found' : 'no_email',
    };
  }

  /** The cataloged code a port call failed with; undefined when it succeeded. */
  private async failureCode(
    call: () => Promise<unknown>,
    signal: AbortSignal,
    timeoutCode: ErrorCode,
    log: Logger,
  ): Promise<ErrorCode | undefined> {
    try {
      await this.callPort(call, signal, timeoutCode, log);

      return undefined;
    } catch (error) {
      if (error instanceof StepFailure) {
        return error.code;
      }

      throw error;
    }
  }

  /**
   * Saves one decision on the incident the plan was made for, then the action's rule. A job
   * whose incident changed meanwhile stops safely (`INCIDENT_CHANGED`).
   */
  private async commitDecision(
    current: StoredJob,
    incident: Incident,
    change: {
      readonly decision: Omit<IncidentDecision, 'at'>;
      readonly detail?: string;
      readonly observations?: SupervisorObservations;
      readonly apply?: (job: BackupJob, now: Date) => BackupJob;
    },
  ): Promise<StoredJob> {
    const { apply, decision, detail, observations } = change;

    return this.store.commit(
      current,
      (latest) => {
        if (
          latest.incident?.code !== incident.code ||
          latest.incident.openedAt !== incident.openedAt ||
          latest.incident.state !== 'awaiting_supervisor'
        ) {
          throw new InvalidJobStateError('INCIDENT_CHANGED', latest.status);
        }

        const now = this.clock.now();
        const recorded = recordSupervisorDecision(latest, now, decision, observations);

        return apply === undefined ? recorded : apply(recorded, now);
      },
      detail,
    );
  }

  /** The newest events and the probe results, for a context after `inspect_status`. Best effort. */
  private async inspection(
    jobId: string,
    log: Logger,
  ): Promise<{ events: JobEvent[]; health: HealthSnapshot } | undefined> {
    try {
      const [events, health] = await Promise.all([
        this.jobs.listEvents(jobId, { limit: INSPECTED_EVENT_COUNT }),
        this.health.read(),
      ]);

      return { events, health };
    } catch (error) {
      log.warn('agent.inspection.failed', { error });

      return undefined;
    }
  }

  /**
   * A port failure is recorded; a safe stop keeps the stored state; anything else (Redis) is
   * thrown, so QStash retries the delivery.
   */
  private async onStepError(
    error: unknown,
    latest: StoredJob,
    log: Logger,
    record: (failure: StepFailure) => Promise<StepResult>,
  ): Promise<StepResult> {
    if (error instanceof StepFailure) {
      log.warn('job.step.failed', { code: error.code });

      return record(error);
    }

    const cause = error instanceof CallbackFailure ? error.failure : error;

    if (!isSafeStop(cause)) {
      throw cause;
    }

    log.info('job.step.stopped', { reason: errorName(cause) });

    return { stored: (await this.jobs.get(latest.job.id)) ?? latest };
  }

  /**
   * Runs a port call within the step's budget. Its failures become a `StepFailure`: the
   * cataloged code, `timeoutCode` once the budget ran out, or `UNKNOWN_ERROR`. A failure of the
   * step's own callback passes through unchanged.
   */
  private async callPort<T>(
    call: () => Promise<T>,
    signal: AbortSignal,
    timeoutCode: ErrorCode,
    log: Logger,
  ): Promise<T> {
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

  private async notify(job: BackupJob): Promise<void> {
    if (job.status === 'COMPLETE') {
      await this.notifications.success(job);
    } else if (job.status === 'FAILED') {
      await this.notifications.failure(job);
    } else if (job.status === 'NEEDS_ATTENTION' && job.incident?.state === 'awaiting_user') {
      await this.notifications.attention(job, job.incident.supervisorSummary);
    }
  }

  /**
   * The next wakeup, if the job needs one: publish with a new token first, then save the token.
   * A failed publish throws before anything is saved, so the delivery's own token stays valid.
   * With nothing to wake for, the token is cleared and any late delivery is stale.
   */
  private async scheduleNext(
    result: StepResult,
    log: Logger,
  ): Promise<{ delaySec?: number; stored: StoredJob }> {
    const { job } = result.stored;

    if (isTerminal(job.status)) {
      return { stored: result.stored };
    }

    const supervising =
      job.status === 'NEEDS_ATTENTION' && job.incident?.state === 'awaiting_supervisor';
    const delaySec =
      supervising && result.delaySec !== undefined
        ? result.delaySec
        : nextWakeupDelaySec(
            job,
            result.retryAfterSec === undefined ? {} : { retryAfterSec: result.retryAfterSec },
          );

    if (delaySec === undefined) {
      return {
        stored: await this.store.commit(result.stored, (latest) =>
          latest.schedule === undefined || isTerminal(latest.status)
            ? latest
            : update(latest, { schedule: undefined }, this.clock.now()),
        ),
      };
    }

    const token = this.ids.token();
    const now = this.clock.now();
    const { messageId } = await this.scheduler.schedule({
      delaySec,
      jobId: job.id,
      reason: job.status === 'NEEDS_ATTENTION' ? 'supervisor' : 'schedule',
      token,
    });
    const schedule = {
      notBefore: new Date(now.getTime() + delaySec * 1000).toISOString(),
      token,
      ...(messageId === undefined ? {} : { messageId }),
    };

    try {
      const stored = await this.store.commit(result.stored, (latest) =>
        isTerminal(latest.status) ? latest : update(latest, { schedule }, this.clock.now()),
      );

      return { delaySec, stored };
    } catch (error) {
      if (!(error instanceof JobConflictError)) {
        throw error;
      }

      // Someone else rotated the token meanwhile; the wakeup just published is stale.
      log.warn('job.wakeup.superseded', { delaySec });

      return { stored: result.stored };
    }
  }
}

function isCurrent(job: BackupJob, token: string): boolean {
  return job.schedule?.token === token;
}

/**
 * A supervisor action found a cause the deterministic classifier knows and never supervises,
 * such as an expired Notion session: the incident becomes that code's and waits for you.
 */
function replacedBy(code: ErrorCode | undefined): Pick<ActionEffect, 'apply' | 'detail'> {
  if (code === undefined || errorCatalog[code].supervised) {
    return {};
  }

  return { apply: (job, now) => replaceIncident(job, now, code), detail: code };
}

function notionStateFor(
  code: ErrorCode | undefined,
): NonNullable<SupervisorObservations['notionSession']>['state'] {
  switch (code) {
    case undefined: {
      return 'valid';
    }

    case 'NOTION_INTERACTIVE_CHALLENGE': {
      return 'challenge';
    }

    case 'NOTION_SESSION_EXPIRED': {
      return 'expired';
    }

    case 'NOTION_WRONG_WORKSPACE': {
      return 'wrong_workspace';
    }

    default: {
      return 'error';
    }
  }
}

/** One `supervisor` event: the action, who chose it, and the model's cleaned rationale. */
function supervisorEventText(plan: ActPlan, effect: ActionEffect, modelId: string): string {
  const { action } = plan;
  const source =
    plan.forced === undefined
      ? `${modelId}, ${plan.confidence ?? 'unknown'} confidence`
      : `forced: ${plan.forced}`;
  const why = plan.rationale === undefined ? '' : ` · ${plan.rationale}`;

  return `supervisor · ${action.action}${actionParams(action)} → ${effect.outcome} (${source})${why}`;
}

function actionParams(action: ActPlan['action']): string {
  switch (action.action) {
    case 'retry_stage': {
      return ` ${action.stage}`;
    }

    case 'search_email_again': {
      return ` from ${action.widenMinutes} min earlier`;
    }

    case 'wait': {
      return ` ${action.minutes} min`;
    }

    default: {
      return '';
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
