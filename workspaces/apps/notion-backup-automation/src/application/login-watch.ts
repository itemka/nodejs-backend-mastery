import type { ErrorCode } from '../domain/error-catalog.js';
import type { BackupJob } from '../domain/job.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { BackupApplicationService } from './backup-service.js';
import type { JobNotifications } from './job-notifications.js';
import type { LoginService, NotificationGate } from './ports.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The codes a job waits on until each login or access is fixed. */
export const loginFixCodes: Readonly<Record<LoginService, readonly ErrorCode[]>> = {
  drive: ['DRIVE_ROOT_INACCESSIBLE'],
  google: ['GOOGLE_AUTH_REQUIRED'],
  notion: ['NOTION_SESSION_EXPIRED', 'NOTION_INTERACTIVE_CHALLENGE', 'NOTION_WRONG_WORKSPACE'],
};

/** How each login or access is fixed, for the warnings. */
export const loginFixes: Readonly<Record<LoginService, string>> = {
  drive:
    'Run drive:check and restore the folder access; a waiting job resumes with the next daily cron.',
  google:
    'Run auth:google, update GOOGLE_REFRESH_TOKEN in Vercel and redeploy; a waiting job resumes with the next daily cron.',
  notion: 'Run auth:notion on your Mac; a waiting job resumes by itself.',
};

/** The login or access a code is fixed by, if any. */
export function loginServiceOf(code: ErrorCode): LoginService | undefined {
  return (Object.keys(loginFixCodes) as LoginService[]).find((service) =>
    loginFixCodes[service].includes(code),
  );
}

/** The login a job waits for: it needs you, for one of the service's codes. */
export function awaitedLogin(job: BackupJob): LoginService | undefined {
  const { incident } = job;

  return job.status === 'NEEDS_ATTENTION' && incident?.state === 'awaiting_user'
    ? loginServiceOf(incident.code)
    : undefined;
}

export interface ResumeDeps {
  /** The waiting job snapshot; capture it before a probe to leave newer incidents alone. */
  readonly job: BackupJob | undefined;
  readonly logger: Logger;
  readonly service: Pick<BackupApplicationService, 'retryIncident'>;
}

/**
 * `resumeAfterLoginFix`: once `service` works again, the supplied waiting job is retried
 * from its stored stage, as `backup_retry` would. Only that incident is retried: one that a
 * retry and a worker have replaced since is left alone, as is any other state. Returns the
 * resumed job.
 */
export async function resumeAfterLoginFix(
  { job: waiting, logger, service }: ResumeDeps,
  login: LoginService,
): Promise<BackupJob | undefined> {
  const incident = waiting?.incident;

  if (waiting === undefined || incident === undefined || awaitedLogin(waiting) !== login) {
    return undefined;
  }

  const job = await service.retryIncident(waiting.id, incident);

  if (job === undefined) {
    logger.info('login.resume.skipped', { jobId: waiting.id, service: login });

    return undefined;
  }

  logger.info('login.resumed', { jobId: job.id, service: login, status: job.status });

  return job;
}

export interface LoginWarningsOptions {
  readonly clock: Clock;
  /** Marks each `expiring` threshold as sent, until a day after the expiry. */
  readonly gate: NotificationGate;
  readonly logger: Logger;
  readonly notifications: Pick<JobNotifications, 'loginWarning'>;
  /** `LOGIN_WARNING_DAYS`: 30, 7 and 1 by default. */
  readonly warningDays: readonly number[];
}

/** The daily cron's login warnings. */
export class LoginWarnings {
  private readonly clock: Clock;
  private readonly gate: NotificationGate;
  private readonly logger: Logger;
  private readonly notifications: Pick<JobNotifications, 'loginWarning'>;
  private readonly warningDays: readonly number[];

  constructor({ clock, gate, logger, notifications, warningDays }: LoginWarningsOptions) {
    this.clock = clock;
    this.gate = gate;
    this.logger = logger;
    this.notifications = notifications;
    this.warningDays = [...warningDays].toSorted((a, b) => a - b);
  }

  /**
   * `lost`: a probe found the access gone. `JobNotifications` sends it at most once per service
   * per 24 h.
   */
  async lost(service: LoginService): Promise<void> {
    await this.notifications.loginWarning({ howToFix: loginFixes[service], kind: 'lost', service });
  }

  /**
   * `expiring`: the Notion sign-in expires within one of the warning days. Each threshold is
   * sent once for this expiry (`warning:notion:<expiresAt>:<days>`, kept until a day after it),
   * so a rolling refresh that moves the expiry starts over. Only the nearest threshold counts:
   * after a missed day, one warning is sent, not one per threshold passed. Returns the
   * threshold sent.
   */
  async notionExpiring(expiresAt?: string): Promise<number | undefined> {
    if (expiresAt === undefined) {
      return undefined;
    }

    const leftMs = Date.parse(expiresAt) - this.clock.now().getTime();

    // An unreadable expiry is NaN: neither past nor future, so no warning.
    if (Number.isNaN(leftMs) || leftMs <= 0) {
      return undefined;
    }

    const daysLeft = Math.ceil(leftMs / DAY_MS);
    // Sorted ascending, so the first threshold reached is the nearest one.
    const nearest = this.warningDays.find((days) => daysLeft <= days);

    if (
      nearest === undefined ||
      !(await this.gate.claim(
        `warning:notion:${expiresAt}:${nearest}`,
        Math.ceil((leftMs + DAY_MS) / 1000),
      ))
    ) {
      return undefined;
    }

    await this.notifications.loginWarning({
      daysLeft,
      expiresAt,
      howToFix: loginFixes.notion,
      kind: 'expiring',
      service: 'notion',
    });
    this.logger.info('login.expiring', { daysLeft, threshold: nearest });

    return nearest;
  }
}
