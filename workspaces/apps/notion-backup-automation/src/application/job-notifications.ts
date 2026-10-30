import type { ErrorCode } from '../domain/error-catalog.js';
import { errorCatalog } from '../domain/error-catalog.js';
import type { BackupJob } from '../domain/job.js';
import { DEV_FOLDER_NAME, yearFolderName } from '../domain/naming.js';
import type { BackupPolicy } from '../domain/policy.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import { attentionText, failureText, lateEmailText, successText } from './notification-text.js';
import type {
  AttentionNotification,
  FailureNotification,
  HealthStore,
  JobRepository,
  LateEmailNotification,
  LoginWarningNotification,
  NotificationEventLine,
  NotificationGate,
  Notifier,
  SuccessNotification,
} from './ports.js';

/**
 * An `attention` repeats at most once per job and code, a `lost` warning once per service, and a
 * late email once per export attempt, per 24 h.
 */
export const REPEAT_WINDOW_SEC = 24 * 60 * 60;

const RECENT_EVENT_COUNT = 10;
/** An ended job writes few events after its end, so its notification is among the newest. */
const SENT_SCAN_COUNT = 20;
const MAX_EVENT_TEXT = 400;

export interface JobNotificationsOptions {
  readonly clock?: Clock;
  /** `APP_ENV=dev`: backups are stored under `_dev/<YYYY>`. */
  readonly devFolder: boolean;
  readonly gate: NotificationGate;
  readonly health: Pick<HealthStore, 'write'>;
  readonly jobs: Pick<JobRepository, 'appendEvent' | 'listEvents'>;
  readonly logger: Logger;
  readonly notifier: Notifier;
  readonly policy: Pick<BackupPolicy, 'maxExportAttempts'>;
}

/**
 * Sends a job's notifications, built from the job's allowlisted fields only, and records each
 * in `events:<jobId>`, since Hobby keeps runtime logs for an hour. Login warnings belong to no
 * job, so the last one is recorded in `health`. Nothing here throws: a notification never
 * fails the tick or the cron run that sends it.
 */
export class JobNotifications {
  private readonly clock: Clock;
  private readonly devFolder: boolean;
  private readonly gate: NotificationGate;
  private readonly health: Pick<HealthStore, 'write'>;
  private readonly jobs: Pick<JobRepository, 'appendEvent' | 'listEvents'>;
  private readonly logger: Logger;
  private readonly notifier: Notifier;
  private readonly policy: Pick<BackupPolicy, 'maxExportAttempts'>;

  constructor({
    clock = systemClock,
    devFolder,
    gate,
    health,
    jobs,
    logger,
    notifier,
    policy,
  }: JobNotificationsOptions) {
    this.clock = clock;
    this.devFolder = devFolder;
    this.gate = gate;
    this.health = health;
    this.jobs = jobs;
    this.logger = logger;
    this.notifier = notifier;
    this.policy = policy;
  }

  /** The job needs a person: its incident's code, the fix, and the recent events. */
  async attention(job: BackupJob, supervisorSummary?: string): Promise<void> {
    await this.guard('attention', job.id, async () => {
      const { incident } = job;

      if (job.status !== 'NEEDS_ATTENTION' || incident === undefined) {
        throw new RangeError('Only a job that needs attention has an incident to report');
      }

      if (!(await this.firstInWindow(`attention:${job.id}:${incident.code}`))) {
        this.logger.info('notify.skipped', {
          code: incident.code,
          jobId: job.id,
          kind: 'attention',
        });

        return;
      }

      const definition = errorCatalog[incident.code];
      const notification: AttentionNotification = {
        code: incident.code,
        howToFix: definition.howToFix,
        jobId: job.id,
        period: job.period,
        reason: definition.description,
        recentEvents: await this.recentEvents(job.id),
        retryFromScratch: job.exportAttempt < this.policy.maxExportAttempts,
        stage: incident.stage,
        ...(supervisorSummary === undefined ? {} : { supervisorSummary }),
      };

      await this.notifier.attention(notification);
      await this.record(job, attentionText(notification), incident.code);
    });
  }

  /** The job ended as FAILED. */
  async failure(job: BackupJob): Promise<void> {
    await this.guard('failure', job.id, async () => {
      const { lastError } = job;

      if (job.status !== 'FAILED' || lastError === undefined) {
        throw new RangeError('Only a FAILED job has a failure to report');
      }

      if (await this.alreadySent(job)) {
        return;
      }

      const notification: FailureNotification = {
        code: lastError.code,
        jobId: job.id,
        period: job.period,
        reason: errorCatalog[lastError.code].description,
        stage: lastError.stage,
      };

      await this.notifier.failure(notification);
      await this.record(job, failureText(notification), lastError.code);
    });
  }

  /** The export email is overdue: said once a day, while the job keeps checking. */
  async lateEmail(job: BackupJob): Promise<void> {
    await this.guard('lateEmail', job.id, async () => {
      const { requestedAt } = job;

      if (job.status !== 'WAITING_FOR_EMAIL' || requestedAt === undefined) {
        throw new RangeError('Only a job waiting for its export email can have a late one');
      }

      if (!(await this.firstInWindow(`late-email:${job.id}:${job.exportAttempt}`))) {
        return;
      }

      const notification: LateEmailNotification = {
        exportAttempt: job.exportAttempt,
        jobId: job.id,
        period: job.period,
        waitedMs: this.clock.now().getTime() - Date.parse(requestedAt),
      };

      await this.notifier.lateEmail(notification);
      await this.record(job, lateEmailText(notification));
    });
  }

  async loginWarning(notification: LoginWarningNotification): Promise<void> {
    await this.guard('loginWarning', undefined, async () => {
      if (
        notification.kind === 'lost' &&
        !(await this.firstInWindow(`lost:${notification.service}`))
      ) {
        this.logger.info('notify.skipped', { kind: 'lost', service: notification.service });

        return;
      }

      await this.notifier.loginWarning(notification);
      await this.health.write('loginWarning', {
        kind: notification.kind,
        sentAt: this.clock.now().toISOString(),
        service: notification.service,
      });
    });
  }

  /** The job is COMPLETE: its backup, and how it compares with the last one. */
  async success(job: BackupJob): Promise<void> {
    await this.guard('success', job.id, async () => {
      const { completedAt, result } = job;

      if (job.status !== 'COMPLETE' || result === undefined || completedAt === undefined) {
        throw new RangeError('Only a COMPLETE job has a backup to report');
      }

      if (await this.alreadySent(job)) {
        return;
      }

      const year = yearFolderName(job.period);
      const notification: SuccessNotification = {
        driveFileId: result.driveFileId,
        durationMs: Date.parse(completedAt) - Date.parse(job.createdAt),
        fileName: result.fileName,
        folder: this.devFolder ? `${DEV_FOLDER_NAME}/${year}` : year,
        jobId: job.id,
        period: job.period,
        sizeBytes: result.sizeBytes,
        ...(result.entryCount === undefined ? {} : { entryCount: result.entryCount }),
        ...(result.shrink === undefined ? {} : { shrink: result.shrink }),
      };

      await this.notifier.success(notification);
      await this.record(job, successText(notification));
    });
  }

  /**
   * A job's success or failure is sent once: its `notification` event marks it sent. A worker
   * that died before sending left no event, so a later delivery sends it. Unreadable events let
   * it through: a repeat beats a lost alert.
   */
  private async alreadySent(job: BackupJob): Promise<boolean> {
    let events;

    try {
      events = await this.jobs.listEvents(job.id, { limit: SENT_SCAN_COUNT });
    } catch (error) {
      this.logger.warn('notify.events.failed', { error, jobId: job.id });

      return false;
    }

    const sent = events.some(
      ({ status, type }) => type === 'notification' && status === job.status,
    );

    if (sent) {
      this.logger.info('notify.skipped', {
        jobId: job.id,
        kind: job.status,
        reason: 'already_sent',
      });
    }

    return sent;
  }

  /** A gate that cannot answer lets the notification through: a repeat beats a lost alert. */
  private async firstInWindow(key: string): Promise<boolean> {
    try {
      return await this.gate.claim(key, REPEAT_WINDOW_SEC);
    } catch (error) {
      this.logger.warn('notify.gate.failed', { error });

      return true;
    }
  }

  private async guard(
    kind: string,
    jobId: string | undefined,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.warn('notify.record.failed', { error, jobId, kind });
    }
  }

  /** The events behind an attention notification; without them, it is still sent. */
  private async recentEvents(jobId: string): Promise<NotificationEventLine[]> {
    try {
      const events = await this.jobs.listEvents(jobId, { limit: RECENT_EVENT_COUNT });

      return events.map(({ at, text }) => ({ at, text }));
    } catch (error) {
      this.logger.warn('notify.events.failed', { error, jobId });

      return [];
    }
  }

  /** The notification as a job event, with the code it reports. */
  private async record(job: BackupJob, text: string, code?: ErrorCode): Promise<void> {
    await this.jobs.appendEvent(job.id, {
      at: this.clock.now().toISOString(),
      status: job.status,
      text: text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT - 1)}…` : text,
      type: 'notification',
      ...(code === undefined ? {} : { code }),
    });
  }
}
