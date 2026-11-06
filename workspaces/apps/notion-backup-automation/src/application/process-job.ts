import {
  beginExportTrigger,
  cancelJob,
  failLifetimeExceeded,
  isEmailLate,
  recordExportRequested,
  resumeAfterBackoff,
  rollbackTransfer,
} from '../domain/job-lifecycle.js';
import type { BackupJob } from '../domain/job.js';
import type { LeaseKind, StepKind } from '../domain/next-step.js';
import { LEASE_TTL_MS, leaseKindFor, nextStep } from '../domain/next-step.js';
import { nextWakeupDelaySec } from '../domain/schedule-policy.js';
import type { JobStatus } from '../domain/statuses.js';
import { isTerminal } from '../domain/statuses.js';
import { update } from '../domain/transitions.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import type { JobNotifications } from './job-notifications.js';
import { checkEmail } from './job-steps/check-email.js';
import type { Step, StepDependencies, StepResult } from './job-steps/step-runner.js';
import { commitStep, errorName, isSafeStop } from './job-steps/step-runner.js';
import { supervise } from './job-steps/supervise.js';
import { transferExport } from './job-steps/transfer-export.js';
import { triggerExport } from './job-steps/trigger-export.js';
import { JobConflictError, JobStore } from './job-store.js';
import type { NotionLoginRequests } from './notion-auto-login.js';
import type { Scheduler, StoredJob, WakeupReason } from './ports.js';

/**
 * How long a step may start new work: a heavy one stops at 270 s, inside the 300 s function
 * limit and the 330 s lease; a light one well inside its 60 s lease.
 */
export const STEP_BUDGET_MS: Readonly<Record<LeaseKind, number>> = {
  heavy: 270_000,
  light: 45_000,
};

/** The work of each step kind `nextStep` picks; the domain decides which one is due. */
const steps: Readonly<Record<StepKind, Step>> = {
  await_email_in_doubt: commitStep(
    (job, now) => recordExportRequested(job, now, 'in_doubt'),
    'in doubt',
  ),
  begin_trigger: commitStep(beginExportTrigger),
  cancel: commitStep(cancelJob),
  check_email: checkEmail,
  fail_lifetime: commitStep(failLifetimeExceeded),
  noop: (_ctx, current) => Promise.resolve({ stored: current }),
  resume: commitStep(resumeAfterBackoff),
  rollback_orphan: commitStep(
    (job, now, policy) => rollbackTransfer(job, now, 'orphaned', policy),
    'orphaned',
  ),
  supervise,
  transfer: transferExport,
  trigger_export: triggerExport,
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

export interface ProcessJobOptions extends StepDependencies {
  readonly budgetsMs?: Readonly<Record<LeaseKind, number>>;
  readonly ids: IdGenerator;
  readonly notifications: Pick<JobNotifications, 'attention' | 'failure' | 'lateEmail' | 'success'>;
  /**
   * Asks for the automatic Notion login when a tick finds the session gone (Phase 14); the job
   * waits for you as before, and the login's success resumes it.
   */
  readonly notionLogin?: Pick<NotionLoginRequests, 'request'>;
  readonly scheduler: Scheduler;
}

/**
 * One tick of one job (`ProcessJobUseCase.execute`): load, lease, reload, check the token, run
 * exactly one step with compare-and-set transitions, notify, then publish the next wakeup and
 * save its token. The lease is released whatever happens.
 */
export class ProcessJobUseCase {
  private readonly store: JobStore;

  constructor(private readonly options: ProcessJobOptions) {
    this.store = new JobStore({ clock: options.clock, jobs: options.jobs, logger: options.logger });
  }

  async execute(request: TickRequest): Promise<TickResult> {
    const { clock, ids, jobs, policy } = this.options;
    const log = this.options.logger.child({ jobId: request.jobId, tickId: ids.shortId() });
    const first = await jobs.get(request.jobId);

    if (first === undefined) {
      return { outcome: 'not_found' };
    }

    if (isTerminal(first.job.status)) {
      // A worker that died between saving the end and notifying left it unsent; it is sent once.
      await this.notify(first.job);

      return { outcome: 'terminal', status: first.job.status };
    }

    const planned = nextStep(first.job, clock.now(), policy);
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
    const workerId = ids.shortId();
    const acquired = await jobs.acquireLease(request.jobId, workerId, LEASE_TTL_MS[lease]);

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
        await jobs.releaseLease(request.jobId, workerId);
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
    const { budgetsMs = STEP_BUDGET_MS, clock, jobs, policy } = this.options;
    const current = await jobs.get(request.jobId);

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

    const step = nextStep(current.job, clock.now(), policy);
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
      result = await steps[step.kind](
        {
          ...this.options,
          log,
          signal: AbortSignal.timeout(budgetsMs[needed]),
          store: this.store,
        },
        current,
      );
    } catch (error) {
      if (!isSafeStop(error)) {
        throw error;
      }

      log.info('job.step.stopped', { reason: errorName(error) });
      result = { stored: (await jobs.get(current.job.id)) ?? current };
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

  private async notify(job: BackupJob): Promise<void> {
    const { notifications } = this.options;

    if (job.status === 'COMPLETE') {
      await notifications.success(job);
    } else if (job.status === 'FAILED') {
      await notifications.failure(job);
    } else if (job.status === 'NEEDS_ATTENTION' && job.incident?.state === 'awaiting_user') {
      await notifications.attention(job, job.incident.supervisorSummary);

      if (job.incident.code === 'NOTION_SESSION_EXPIRED') {
        await this.requestNotionLogin(job.id);
      }
    } else if (isEmailLate(job, this.options.clock.now())) {
      await notifications.lateEmail(job);
    }
  }

  /**
   * The automatic Notion login, at most one a day: a repeat notify of the same incident is
   * refused by its gate. Best effort, like a notification: it never fails the tick.
   */
  private async requestNotionLogin(jobId: string): Promise<void> {
    const { logger, notionLogin } = this.options;

    if (notionLogin === undefined) {
      return;
    }

    try {
      const outcome = await notionLogin.request('expired');

      logger.info('job.notion_login', { jobId, outcome });
    } catch (error) {
      logger.warn('job.notion_login.failed', { error, jobId });
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
    const { clock, ids, scheduler } = this.options;
    const { job } = result.stored;

    if (isTerminal(job.status)) {
      return { stored: result.stored };
    }

    const supervising =
      job.status === 'NEEDS_ATTENTION' && job.incident?.state === 'awaiting_supervisor';
    const hints = result.retryAfterSec === undefined ? {} : { retryAfterSec: result.retryAfterSec };
    const delaySec =
      supervising && result.delaySec !== undefined
        ? result.delaySec
        : nextWakeupDelaySec(job, hints);

    if (delaySec === undefined) {
      return {
        stored: await this.store.commit(result.stored, (latest) =>
          latest.schedule === undefined || isTerminal(latest.status)
            ? latest
            : update(latest, { schedule: undefined }, clock.now()),
        ),
      };
    }

    const token = ids.token();
    const now = clock.now();
    const { messageId } = await scheduler.schedule({
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
        isTerminal(latest.status) ? latest : update(latest, { schedule }, clock.now()),
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
