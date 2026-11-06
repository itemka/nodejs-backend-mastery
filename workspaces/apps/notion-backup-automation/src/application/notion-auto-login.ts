import type { BackupJob } from '../domain/job.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { ApplicationError } from './application-error.js';
import type { BackupApplicationService } from './backup-service.js';
import type { HealthSnapshot } from './health-snapshot.js';
import type { JobNotifications } from './job-notifications.js';
import type { LoginWarnings } from './login-watch.js';
import { loginFixes, resumeAfterLoginFix } from './login-watch.js';
import type { NotionLoginFailure } from './notion-login-error.js';
import { notionLoginFailureOf } from './notion-login-error.js';
import type {
  HealthStore,
  JobRepository,
  NotificationGate,
  NotionEmailLogin,
  NotionLoginInfo,
  NotionLoginQueue,
  NotionLoginRequest,
  NotionLoginSlot,
  NotionLoginTrigger,
} from './ports.js';

/** At most one automatic login a day, whatever its outcome (Phase 14). */
export const NOTION_LOGIN_INTERVAL_SEC = 24 * 60 * 60;

/** S7's pass criterion: the whole login well inside the worker's 300 s. */
export const NOTION_LOGIN_BUDGET_MS = 120_000;

/**
 * - `disabled`: `NOTION_AUTO_LOGIN_ENABLED` is off, so the warnings stay as they were;
 * - `queued`: the worker runs the login and reports its outcome;
 * - `refused`: a login was already tried within 24 h;
 * - `failed`: the request could not be published, so this day's attempt is lost.
 */
export type NotionLoginRequestOutcome = 'disabled' | 'failed' | 'queued' | 'refused';

export interface NotionLoginRequestsOptions {
  readonly enabled: boolean;
  readonly ids: Pick<IdGenerator, 'token'>;
  readonly logger: Logger;
  /** Absent where nothing may publish (`dev:tick`, the CLI): every request is then `disabled`. */
  readonly queue: NotionLoginQueue | undefined;
  readonly slot: Pick<NotionLoginSlot, 'claim'>;
}

/**
 * Asks the worker for one automatic Notion login, at most once per 24 h across every trigger:
 * the slot is claimed with the attempt's ID before the publish, so a failed publish costs that
 * day's attempt rather than risking a second one. The supervisor never calls this.
 */
export class NotionLoginRequests {
  constructor(private readonly options: NotionLoginRequestsOptions) {}

  async request(trigger: NotionLoginTrigger): Promise<NotionLoginRequestOutcome> {
    const { enabled, ids, logger, queue, slot } = this.options;

    if (!enabled || queue === undefined) {
      return 'disabled';
    }

    const attempt = ids.token();

    if (!(await slot.claim(attempt, NOTION_LOGIN_INTERVAL_SEC))) {
      logger.info('notion.login.refused', { trigger });

      return 'refused';
    }

    try {
      await queue.enqueueNotionLogin({ attempt, trigger });
    } catch (error) {
      logger.error('notion.login.request_failed', { error, trigger });

      return 'failed';
    }

    logger.info('notion.login.queued', { trigger });

    return 'queued';
  }
}

/**
 * - `renewed`: a new session is saved, and "Notion login renewed" sent;
 * - `failed`: the login stopped; the trigger's warning was sent;
 * - `duplicate`: QStash delivered this attempt again; nothing ran;
 * - `stale`: the attempt does not hold the day's slot (expired, or never claimed); nothing ran;
 * - `disabled`: the flag was turned off after the request; nothing ran.
 */
export type NotionLoginRunOutcome = 'disabled' | 'duplicate' | 'failed' | 'renewed' | 'stale';

export interface NotionLoginRunResult {
  readonly failure?: NotionLoginFailure;
  readonly outcome: NotionLoginRunOutcome;
  /** The job that waited for the Notion login and was retried. */
  readonly resumedJobId?: string;
}

export interface NotionAutoLoginOptions {
  /** The login's budget; S7's 120 s by default. */
  readonly budgetMs?: number;
  readonly clock: Clock;
  readonly enabled: boolean;
  readonly gate: NotificationGate;
  readonly health: Pick<HealthStore, 'write'>;
  readonly jobs: Pick<JobRepository, 'findActive'>;
  readonly logger: Logger;
  readonly login: NotionEmailLogin;
  readonly notifications: Pick<JobNotifications, 'loginWarning'>;
  /** The saved sign-in's expiry, for an `expiring` warning after a failure. */
  readonly sessionInfo: NotionLoginInfo;
  readonly service: Pick<BackupApplicationService, 'retryIncident'>;
  /** Only the attempt that holds the day's slot runs, as only a job's current token ticks it. */
  readonly slot: Pick<NotionLoginSlot, 'holds'>;
  readonly warnings: Pick<LoginWarnings, 'lost' | 'notionExpiring'>;
}

/**
 * The worker's `_notion-login`: one email-code login per attempt, then what follows it. Renewed:
 * the session is recorded as valid, the job that waited for the Notion login resumes, and
 * "Notion login renewed, valid until …" is sent. Failed or challenged: no retry; an `expired`
 * attempt sends the `lost` warning with the `auth:notion` fix, an `expiring` one the expiry
 * warning it replaced, or `lost` once the saved sign-in has expired meanwhile. Either way one Telegram message, and the outcome is kept in `health`.
 */
export class NotionAutoLogin {
  constructor(private readonly options: NotionAutoLoginOptions) {}

  async run({ attempt, trigger }: NotionLoginRequest): Promise<NotionLoginRunResult> {
    const { clock, enabled, gate, jobs, logger, login, slot } = this.options;

    if (!enabled) {
      logger.info('notion.login.skipped', { reason: 'disabled', trigger });

      return { outcome: 'disabled' };
    }

    // Read before the claim, so a Redis failure here leaves the attempt to QStash's retry, and
    // before the login, so an incident raised meanwhile is left alone.
    const waiting = await jobs.findActive();

    if (!(await slot.holds(attempt))) {
      logger.warn('notion.login.skipped', { reason: 'stale', trigger });

      return { outcome: 'stale' };
    }

    if (!(await gate.claim(`notion-login:run:${attempt}`, NOTION_LOGIN_INTERVAL_SEC))) {
      logger.info('notion.login.skipped', { reason: 'duplicate', trigger });

      return { outcome: 'duplicate' };
    }

    const startedAt = clock.now();
    const signal = AbortSignal.timeout(this.options.budgetMs ?? NOTION_LOGIN_BUDGET_MS);

    logger.info('notion.login.start', { trigger });

    try {
      const renewed = await login.renewSession(signal);

      return await this.renewed(trigger, startedAt, renewed.authCookieExpiresAt, waiting?.job);
    } catch (error) {
      const failure = notionLoginFailureOf(error, signal);

      logger.warn('notion.login.failed', {
        error: error instanceof Error ? error.name : 'Error',
        failure,
        trigger,
      });
      await this.failed(trigger, startedAt, failure);

      return { failure, outcome: 'failed' };
    }
  }

  private async renewed(
    trigger: NotionLoginTrigger,
    startedAt: Date,
    authCookieExpiresAt: string | undefined,
    waiting: BackupJob | undefined,
  ): Promise<NotionLoginRunResult> {
    const { clock, logger, notifications } = this.options;
    const checkedAt = clock.now().toISOString();

    await this.record('notionSession', {
      checkedAt,
      state: 'valid',
      ...(authCookieExpiresAt === undefined ? {} : { authCookieExpiresAt }),
    });
    await this.recordAttempt(trigger, startedAt, 'renewed');

    const resumedJobId = await this.resume(waiting);

    await notifications.loginWarning({
      howToFix: loginFixes.notion,
      kind: 'renewed',
      service: 'notion',
      ...(authCookieExpiresAt === undefined ? {} : { expiresAt: authCookieExpiresAt }),
    });
    logger.info('notion.login.renewed', { resumedJobId, trigger });

    return { outcome: 'renewed', ...(resumedJobId === undefined ? {} : { resumedJobId }) };
  }

  private async failed(
    trigger: NotionLoginTrigger,
    startedAt: Date,
    failure: NotionLoginFailure,
  ): Promise<void> {
    const { clock, sessionInfo, warnings } = this.options;

    await this.recordAttempt(trigger, startedAt, 'failed', failure);

    // A renewal ahead of time stood in for the expiry warning; but if the saved sign-in has no
    // readable expiry, or it passed while the login was queued or running, there is nothing to
    // warn about any more: the session is gone, and only `lost` tells you.
    const expiresAt = trigger === 'expiring' ? await sessionInfo.authCookieExpiresAt() : undefined;
    const leftMs =
      expiresAt === undefined ? Number.NaN : Date.parse(expiresAt) - clock.now().getTime();

    await (leftMs > 0 ? warnings.notionExpiring(expiresAt) : warnings.lost('notion'));
  }

  /**
   * Retries the job that waited for Notion. The session is saved by now, so a resume that fails
   * (another invocation holds the job, or the publish failed) never hides the renewal: the job
   * stays waiting, and the daily cron's Notion probe, due while a job waits for it, resumes it.
   */
  private async resume(job: BackupJob | undefined): Promise<string | undefined> {
    const { logger, service } = this.options;

    try {
      const resumed = await resumeAfterLoginFix({ job, logger, service }, 'notion');

      return resumed?.id;
    } catch (error) {
      logger.warn('notion.login.resume_deferred', {
        code: error instanceof ApplicationError ? error.code : undefined,
        error: error instanceof Error ? error.name : 'Error',
        jobId: job?.id,
      });

      return undefined;
    }
  }

  private async recordAttempt(
    trigger: NotionLoginTrigger,
    startedAt: Date,
    outcome: 'failed' | 'renewed',
    failure?: NotionLoginFailure,
  ): Promise<void> {
    const now = this.options.clock.now();

    await this.record('notionLogin', {
      at: startedAt.toISOString(),
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      outcome,
      trigger,
      ...(failure === undefined ? {} : { failure }),
    });
  }

  /** Best effort: a Redis hiccup must not hide the login's outcome from you. */
  private async record<F extends 'notionLogin' | 'notionSession'>(
    field: F,
    value: NonNullable<HealthSnapshot[F]>,
  ): Promise<void> {
    try {
      await this.options.health.write(field, value);
    } catch (error) {
      this.options.logger.warn('notion.login.record_failed', { error, field });
    }
  }
}
