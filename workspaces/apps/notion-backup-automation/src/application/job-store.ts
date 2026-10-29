import type { ErrorCode } from '../domain/error-catalog.js';
import type { JobEvent } from '../domain/job-event.js';
import type { BackupJob } from '../domain/job.js';
import type { JobStatus } from '../domain/statuses.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { JobRepository, StoredJob } from './ports.js';

/** On a version conflict the job is reloaded and the rule applied again, up to this many times. */
export const MAX_CONFLICT_RELOADS = 3;

const MAX_EVENT_TEXT = 400;

const failureStatuses: ReadonlySet<JobStatus> = new Set([
  'FAILED',
  'NEEDS_ATTENTION',
  'RETRYABLE_FAILURE',
]);

/**
 * The job kept changing under a write, or vanished. The caller stops safely: nothing was written,
 * and the next tick re-evaluates the stored state.
 */
export class JobConflictError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} changed during the write; stopping`);
    this.name = 'JobConflictError';
  }
}

/**
 * Writes jobs with compare-and-set and keeps their event history. A rule is a pure lifecycle
 * function of the stored job: on a conflict it is applied again to the reloaded job, so its
 * preconditions are checked against what is really stored.
 */
export class JobStore {
  private readonly clock: Clock;
  private readonly jobs: JobRepository;
  private readonly logger: Logger;

  constructor({ clock, jobs, logger }: { clock: Clock; jobs: JobRepository; logger: Logger }) {
    this.clock = clock;
    this.jobs = jobs;
    this.logger = logger;
  }

  /**
   * Saves `rule(job)` and records a status change as a `transition` event, with `detail` (or the
   * failure code) in its text. A rule that returns the job unchanged writes nothing.
   */
  async commit(
    current: StoredJob,
    rule: (job: BackupJob) => BackupJob,
    detail?: string,
  ): Promise<StoredJob> {
    let base = current;

    for (let reloads = 0; ; reloads += 1) {
      const next = rule(base.job);

      if (next === base.job) {
        return base;
      }

      const result = await this.jobs.update(base.job.id, base.version, next);

      if (result.outcome === 'updated') {
        await this.recordTransition(base.job, next, detail);

        return { job: next, version: result.version };
      }

      const reloaded =
        result.outcome === 'conflict' && reloads < MAX_CONFLICT_RELOADS
          ? await this.jobs.get(base.job.id)
          : undefined;

      if (reloaded === undefined) {
        throw new JobConflictError(base.job.id);
      }

      base = reloaded;
    }
  }

  /** A `note` event: what a step learned that is no status change. Best effort. */
  async note(jobId: string, text: string, code?: ErrorCode): Promise<void> {
    await this.append(jobId, {
      at: this.clock.now().toISOString(),
      text: clip(text),
      type: 'note',
      ...(code === undefined ? {} : { code }),
    });
  }

  /** A `supervisor` event: one decision and what it did. Best effort. */
  async supervisor(jobId: string, text: string, code?: ErrorCode): Promise<void> {
    await this.append(jobId, {
      at: this.clock.now().toISOString(),
      text: clip(text),
      type: 'supervisor',
      ...(code === undefined ? {} : { code }),
    });
  }

  private async recordTransition(
    previous: BackupJob,
    next: BackupJob,
    detail: string | undefined,
  ): Promise<void> {
    if (previous.status === next.status) {
      return;
    }

    const code =
      failureStatuses.has(next.status) && next.lastError !== undefined
        ? next.lastError.code
        : undefined;
    const suffix = detail ?? code;

    await this.append(next.id, {
      at: next.updatedAt,
      status: next.status,
      text: clip(
        `${previous.status} → ${next.status}${suffix === undefined ? '' : ` (${suffix})`}`,
      ),
      type: 'transition',
      ...(code === undefined ? {} : { code }),
    });
  }

  /** Events are history: a failed append is logged and never fails the step. */
  private async append(jobId: string, event: JobEvent): Promise<void> {
    try {
      await this.jobs.appendEvent(jobId, event);
    } catch (error) {
      this.logger.warn('job.event.failed', { error, jobId, type: event.type });
    }
  }
}

function clip(text: string): string {
  return text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT - 1)}…` : text;
}
