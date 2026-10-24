import { InvalidJobStateError, InvalidTransitionError } from '../domain/domain-errors.js';
import type { JobEvent } from '../domain/job-event.js';
import { cancelJob, requestCancel, retryJob } from '../domain/job-lifecycle.js';
import type { BackupJob } from '../domain/job.js';
import { newBackupJob } from '../domain/job.js';
import { nextForcedRevision } from '../domain/naming.js';
import { periodFor } from '../domain/period.js';
import type { BackupPolicy } from '../domain/policy.js';
import type { Stage } from '../domain/statuses.js';
import { isTerminal } from '../domain/statuses.js';
import { update } from '../domain/transitions.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { redactString } from '../shared/redact.js';
import { ApplicationError } from './application-error.js';
import { JobStore } from './job-store.js';
import type { JobRepository, Scheduler, StoredJob, WakeupReason } from './ports.js';

/**
 * `backup_process`, `backup_retry` and `backup_cancel` hold the job's lease while they write,
 * so no tick interleaves, and a wakeup delivered before its token is saved waits for it.
 */
export const CONTROL_LEASE_MS = 15_000;

/** Enough jobs to find a period's forced revisions. */
const FORCED_SCAN_LIMIT = 100;
const STATUS_EVENT_COUNT = 10;
const MAX_REASON_LENGTH = 200;

export interface BackupServiceOptions {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly jobs: JobRepository;
  readonly logger: Logger;
  readonly policy: BackupPolicy;
  readonly scheduler: Scheduler;
  /** `BACKUP_TIME_ZONE`: the period is derived from "now" here, never passed in. */
  readonly timeZone: string;
}

export interface StartRequest {
  /** A new job for a period that already has one: `<period>-r<N>`. Refused while a job is active. */
  readonly force?: boolean;
  /** `scheduled` for the daily cron's auto-start. */
  readonly kind?: 'manual' | 'scheduled';
  /** Free text from the caller, kept (redacted, at most 200 characters) in the first event. */
  readonly reason?: string;
}

export interface StartResult {
  /** False when the period's job already existed; it is returned as it is. */
  readonly created: boolean;
  readonly job: BackupJob;
}

export interface ProcessResult {
  readonly job: BackupJob;
  readonly queued: boolean;
  readonly reason: 'leased' | 'queued' | 'terminal';
}

export interface JobStatusResult {
  /** The newest events, oldest first. */
  readonly events: readonly JobEvent[];
  readonly job: BackupJob;
}

/**
 * The application methods behind the MCP tools, the Telegram buttons and the cron. They change
 * jobs only through the domain rules with compare-and-set, and never run a step inline: work
 * happens in the worker, woken by a published wakeup.
 */
export class BackupApplicationService {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly jobs: JobRepository;
  private readonly logger: Logger;
  private readonly policy: BackupPolicy;
  private readonly scheduler: Scheduler;
  private readonly store: JobStore;
  private readonly timeZone: string;

  constructor(options: BackupServiceOptions) {
    this.clock = options.clock;
    this.ids = options.ids;
    this.jobs = options.jobs;
    this.logger = options.logger;
    this.policy = options.policy;
    this.scheduler = options.scheduler;
    this.store = new JobStore({ clock: options.clock, jobs: options.jobs, logger: options.logger });
    this.timeZone = options.timeZone;
  }

  /** `backup_cancel`: at once, or at the next step boundary while a worker runs the job. */
  async cancel(jobId: string, reason: string): Promise<{ readonly job: BackupJob }> {
    const stored = await this.require(jobId);

    if (isTerminal(stored.job.status)) {
      throw new ApplicationError(
        'INVALID_STATE',
        `Job ${jobId} is already ${stored.job.status}`,
        jobId,
      );
    }

    const saved = await this.asInvalidState(jobId, () =>
      this.withControlLease(
        jobId,
        async () => {
          const current = await this.require(jobId);
          const cancelled = await this.store.commit(
            current,
            (job) => cancelJob(job, this.clock.now()),
            'backup_cancel',
          );

          await this.cancelSuperseded(current.job);

          return cancelled;
        },
        () => this.store.commit(stored, (job) => requestCancel(job, this.clock.now())),
      ),
    );

    await this.store.note(jobId, `cancel.requested · ${sanitizeReason(reason)}`);

    return { job: saved.job };
  }

  /** `backup_list`: the newest jobs first. */
  async list(limit: number): Promise<BackupJob[]> {
    const stored = await this.jobs.list({ limit });

    return stored.map(({ job }) => job);
  }

  /** `backup_process`: a new token and an immediate wakeup. Nothing runs inline. */
  async process(jobId: string): Promise<ProcessResult> {
    const stored = await this.require(jobId);

    if (isTerminal(stored.job.status)) {
      return { job: stored.job, queued: false, reason: 'terminal' };
    }

    return this.withControlLease<ProcessResult>(
      jobId,
      async () => {
        const current = await this.require(jobId);

        if (isTerminal(current.job.status)) {
          return { job: current.job, queued: false, reason: 'terminal' };
        }

        const saved = await this.reschedule(current, 'manual', (job) => job);

        return { job: saved.job, queued: true, reason: 'queued' };
      },
      () => ({ job: stored.job, queued: false, reason: 'leased' }),
    );
  }

  /**
   * `backup_retry`: from NEEDS_ATTENTION or RETRYABLE_FAILURE back to `fromStage` (default: the
   * failed stage), with that stage's retries reset and the incident closed, then a wakeup.
   */
  async retry(jobId: string, fromStage?: Stage): Promise<{ readonly job: BackupJob }> {
    const stored = await this.require(jobId);
    const rule = (job: BackupJob) => retryJob(job, this.clock.now(), this.policy, fromStage);

    // Refused before anything is published.
    this.asInvalidStateSync(jobId, () => rule(stored.job));

    const saved = await this.asInvalidState(jobId, () =>
      this.withControlLease(
        jobId,
        async () => this.reschedule(await this.require(jobId), 'retry', rule, 'backup_retry'),
        () => {
          throw new ApplicationError(
            'INVALID_STATE',
            `Job ${jobId} is being processed; try again in a minute`,
            jobId,
          );
        },
      ),
    );

    return { job: saved.job };
  }

  /**
   * `backup_start`: the period's job, created with its first token and woken at once. The
   * period is this month in `BACKUP_TIME_ZONE`. An existing job of the period is returned.
   */
  async start(request: StartRequest = {}): Promise<StartResult> {
    const now = this.clock.now();
    const period = periodFor(now, this.timeZone);
    let job: BackupJob;

    if (request.force === true) {
      // Refused while any job is active: `create` answers `active_exists` below.
      const existing = await this.jobs.list({ limit: FORCED_SCAN_LIMIT });

      job = newBackupJob({
        kind: 'forced',
        now,
        period,
        revision: nextForcedRevision(
          period,
          existing.map((stored) => stored.job.id),
        ),
      });
    } else {
      job = newBackupJob({ kind: request.kind ?? 'manual', now, period });
    }

    // The token is saved with the job, so the first wakeup can never arrive before it.
    const token = this.ids.token();
    const created = await this.jobs.create({
      ...job,
      schedule: { notBefore: now.toISOString(), token },
    });

    switch (created.outcome) {
      case 'active_exists': {
        throw activeJobExists(created.activeJobId);
      }

      case 'exists': {
        return { created: false, job: created.stored.job };
      }

      case 'created': {
        const reason = request.reason === undefined ? '' : `: ${sanitizeReason(request.reason)}`;

        await this.store.note(job.id, `job.created · ${job.kind}${reason}`);
        await this.scheduler.schedule({ delaySec: 0, jobId: job.id, reason: 'start', token });
        this.logger.info('job.started', { jobId: job.id, kind: job.kind });

        return { created: true, job: created.stored.job };
      }
    }
  }

  /** `backup_status`: the given job, or the active one, or the latest; with its recent events. */
  async status(jobId?: string): Promise<JobStatusResult> {
    const stored = jobId === undefined ? await this.activeOrLatest() : await this.require(jobId);

    if (stored === undefined) {
      throw new ApplicationError('JOB_NOT_FOUND', 'No backup job exists yet');
    }

    const events = await this.jobs.listEvents(stored.job.id, { limit: STATUS_EVENT_COUNT });

    return { events, job: stored.job };
  }

  private async activeOrLatest(): Promise<StoredJob | undefined> {
    const active = await this.jobs.findActive();

    if (active !== undefined) {
      return active;
    }

    const [latest] = await this.jobs.list({ limit: 1 });

    return latest;
  }

  /** Domain refusals become `INVALID_STATE`, with the domain's reason. */
  private async asInvalidState<T>(jobId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toApplicationError(error, jobId);
    }
  }

  private asInvalidStateSync(jobId: string, run: () => unknown): void {
    try {
      run();
    } catch (error) {
      throw toApplicationError(error, jobId);
    }
  }

  /** Best effort: a superseded message that still arrives is stale and does nothing. */
  private async cancelSuperseded(previous: BackupJob): Promise<void> {
    const messageId = previous.schedule?.messageId;

    if (messageId === undefined) {
      return;
    }

    try {
      await this.scheduler.cancel(messageId);
    } catch (error) {
      this.logger.warn('job.wakeup.cancel_failed', { error, jobId: previous.id });
    }
  }

  /**
   * Applies `rule`, with a new token, after publishing an immediate wakeup for it. A failed
   * publish throws before anything is saved; the old token, and its wakeup, stay valid.
   */
  private async reschedule(
    current: StoredJob,
    reason: WakeupReason,
    rule: (job: BackupJob) => BackupJob,
    detail?: string,
  ): Promise<StoredJob> {
    rule(current.job);

    const token = this.ids.token();
    const now = this.clock.now();
    const { messageId } = await this.scheduler.schedule({
      delaySec: 0,
      jobId: current.job.id,
      reason,
      token,
    });
    const schedule = {
      notBefore: now.toISOString(),
      token,
      ...(messageId === undefined ? {} : { messageId }),
    };
    const saved = await this.store.commit(
      current,
      (job) => update(rule(job), { schedule }, this.clock.now()),
      detail,
    );

    await this.cancelSuperseded(current.job);

    return saved;
  }

  private async require(jobId: string): Promise<StoredJob> {
    const stored = await this.jobs.get(jobId);

    if (stored === undefined) {
      throw new ApplicationError('JOB_NOT_FOUND', `No job ${jobId}`, jobId);
    }

    return stored;
  }

  /**
   * Runs `run` holding the job's lease, or `onHeld` when a worker holds it. The lease is
   * released whatever happens; it expires by itself if the release fails.
   */
  private async withControlLease<T>(
    jobId: string,
    run: () => Promise<T>,
    onHeld: () => Promise<T> | T,
  ): Promise<T> {
    const workerId = this.ids.shortId();
    const lease = await this.jobs.acquireLease(jobId, workerId, CONTROL_LEASE_MS);

    if (!lease.acquired) {
      return onHeld();
    }

    try {
      return await run();
    } finally {
      try {
        await this.jobs.releaseLease(jobId, workerId);
      } catch (error) {
        this.logger.warn('job.lease.release_failed', { error, jobId });
      }
    }
  }
}

function activeJobExists(activeJobId: string): ApplicationError {
  return new ApplicationError(
    'ACTIVE_JOB_EXISTS',
    `Job ${activeJobId} is still active; cancel it or wait for it to end`,
    activeJobId,
  );
}

function toApplicationError(error: unknown, jobId: string): unknown {
  if (error instanceof InvalidJobStateError) {
    return new ApplicationError(
      'INVALID_STATE',
      `Job ${jobId} cannot do that while ${error.status} (${error.reason})`,
      jobId,
    );
  }

  if (error instanceof InvalidTransitionError) {
    return new ApplicationError(
      'INVALID_STATE',
      `Job ${jobId} cannot do that while ${error.from}`,
      jobId,
    );
  }

  return error;
}

/** Caller text in events: no URL, no token-shaped string, at most 200 characters. */
function sanitizeReason(reason: string): string {
  const clean = redactString(reason.replaceAll(/\bhttps?:\/\/\S+/gi, '[link]'))
    .replaceAll(/\s+/g, ' ')
    .trim();

  return clean.length > MAX_REASON_LENGTH ? `${clean.slice(0, MAX_REASON_LENGTH - 1)}…` : clean;
}
