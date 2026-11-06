import type { ErrorCode } from '../domain/error-catalog.js';
import { isLifetimeExceeded } from '../domain/job-lifecycle.js';
import type { BackupJob } from '../domain/job.js';
import { isAutoStartDue, isNotionProbeDay } from '../domain/period.js';
import type { BackupPolicy } from '../domain/policy.js';
import { nextWakeupDelaySec } from '../domain/schedule-policy.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { BackupApplicationService } from './backup-service.js';
import type { LoginWarnings } from './login-watch.js';
import { awaitedLogin, loginServiceOf, resumeAfterLoginFix } from './login-watch.js';
import type { NotionLoginRequestOutcome, NotionLoginRequests } from './notion-auto-login.js';
import type {
  HealthProbes,
  HealthStore,
  JobRepository,
  LoginService,
  NotionLoginInfo,
  NotionLoginTrigger,
  Heartbeat,
} from './ports.js';
import type { ProbeName, ProbeReport } from './probe-runner.js';
import { ProbeRunner } from './probe-runner.js';

/** Which login or access each probe's pass proves. */
const PROBE_SERVICE: Readonly<Record<ProbeName, LoginService>> = {
  drive: 'drive',
  google: 'google',
  notion: 'notion',
};

/** QStash delivers on time; a wakeup this late was lost, so the watchdog publishes it again. */
export const STUCK_AFTER_MS = 60 * 60 * 1000;

export type { ProbeName, ProbeReport } from './probe-runner.js';
export { isProbeName, probeNames } from './probe-runner.js';

export type AutoStartOutcome = 'active_job' | 'disabled' | 'exists' | 'not_due' | 'started';

/**
 * - `idle`: no active job;
 * - `on_schedule`: its next wakeup is not overdue, or it waits for you;
 * - `rearmed`: an overdue job got a new wakeup; `lifetime`: an expired one was woken to end;
 * - `leased`: a worker is on it.
 */
export type WatchdogOutcome = 'idle' | 'leased' | 'lifetime' | 'on_schedule' | 'rearmed';

/** `?probe=`'s answer: the probe, and for a Notion session found gone, the login it asked for. */
export type ProbeAnswer = ProbeReport & { readonly notionLogin?: NotionLoginRequestOutcome };

export interface DailyReport {
  readonly autoStart: AutoStartOutcome | 'failed';
  /** The sub-steps that threw; any one sends the heartbeat's `/fail`. */
  readonly failedSteps: readonly string[];
  /** The automatic Notion login this run asked for, if it asked (Phase 14). */
  readonly notionLogin?: NotionLoginRequestOutcome;
  readonly ok: boolean;
  /** `ok`, the failed probe's code, or `failed` when the probe could not even be recorded. */
  readonly probes: Readonly<Partial<Record<ProbeName, 'failed' | 'ok' | ErrorCode>>>;
  /** Jobs resumed because the login they waited for works again. */
  readonly resumed: readonly string[];
  /** The `expiring` threshold sent today, in days. */
  readonly warnedDays?: number;
  readonly watchdog: 'failed' | WatchdogOutcome;
}

export interface DailyMaintenanceOptions {
  readonly autoStart: { readonly dayOfMonth: number; readonly enabled: boolean };
  /** The automatic Notion login (Phase 14); without it, the warnings stay as they were. */
  readonly autoLogin?: Pick<NotionLoginRequests, 'request'>;
  readonly clock: Clock;
  readonly health: HealthStore;
  readonly heartbeat: Heartbeat;
  readonly jobs: Pick<JobRepository, 'findActive'>;
  readonly logger: Logger;
  readonly notionLogin: NotionLoginInfo;
  readonly policy: BackupPolicy;
  readonly probes: HealthProbes;
  readonly service: Pick<BackupApplicationService, 'process' | 'retryIncident' | 'start'>;
  /** `BACKUP_TIME_ZONE`: the period, the auto-start day and the Notion probe days. */
  readonly timeZone: string;
  readonly warnings: Pick<LoginWarnings, 'lost' | 'notionExpiring' | 'notionExpiryDue'>;
}

/**
 * The daily cron (`/api/cron/daily`), in order: touch Redis; auto-start the period when due,
 * idle and enabled; re-arm a stuck job and end an expired one; probe Google and Drive daily,
 * and Notion on its probe days or while a job waits for its login; warn before the Notion
 * sign-in expires and when access is lost; resume a job whose login works again; ping the
 * heartbeat. Each sub-step that throws is logged and skipped, and turns the ping into `/fail`.
 * With nothing active and auto-start off, the run publishes nothing.
 */
export class DailyMaintenance {
  private readonly probes: ProbeRunner;

  constructor(private readonly options: DailyMaintenanceOptions) {
    this.probes = new ProbeRunner(options);
  }

  /**
   * `?probe=`: one probe, recorded in `health`. A probe's own failure is its result; failing to
   * record it (Redis) throws. A Notion session found gone asks for the automatic login; when
   * that is refused (one a day) or cannot be queued, the `lost` warning goes out instead.
   */
  async probe(name: ProbeName): Promise<ProbeAnswer> {
    const report = await this.probes.probe(name);

    if (!isNotionGone(report)) {
      return report;
    }

    const notionLogin = await this.requestLogin('expired');

    if (notionLogin === 'disabled') {
      return report;
    }

    if (notionLogin === 'refused' || notionLogin === 'failed') {
      await this.options.warnings.lost('notion');
    }

    return { ...report, notionLogin };
  }

  async run(): Promise<DailyReport> {
    const { clock, health, heartbeat, logger } = this.options;
    const ranAt = clock.now().toISOString();
    const failedSteps: string[] = [];

    const failed = (name: string, error: unknown) => {
      failedSteps.push(name);
      logger.error('cron.step.failed', { error, step: name });
    };

    const step = async <T>(name: string, run: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await run();
      } catch (error) {
        failed(name, error);

        return undefined;
      }
    };

    await step('touch', () => health.write('cron', { ranAt }));

    // Without knowing the active job, neither a start nor a re-arm is safe to decide.
    const lookup = await step('active', async () => ({
      active: await this.options.jobs.findActive(),
    }));
    const active = lookup?.active;
    const autoStart =
      (lookup && (await step('autoStart', () => this.autoStart(active)))) ?? 'failed';
    const watchdog = (lookup && (await step('watchdog', () => this.watchdog(active)))) ?? 'failed';
    const probes: Partial<Record<ProbeName, 'failed' | 'ok' | ErrorCode>> = {};
    const resumed: string[] = [];
    let notionLogin: NotionLoginRequestOutcome | undefined;

    // At once, so the slowest budget (Notion's 120 s) bounds the probes, not their sum (210 s):
    // the record and the heartbeat stay well inside the function's 300 s. Results are taken in
    // the probes' order, so the report does not depend on which one finished first.
    const results = await Promise.all(
      this.probesDue(active?.job).map(async (name) => {
        try {
          return { name, outcome: await this.probeAndWatch(name) };
        } catch (error) {
          return { error, name };
        }
      }),
    );

    for (const result of results) {
      if ('error' in result) {
        failed(`probe.${result.name}`, result.error);
        probes[result.name] = 'failed';
        continue;
      }

      probes[result.name] = result.outcome.code ?? 'ok';
      notionLogin = result.outcome.notionLogin ?? notionLogin;

      if (result.outcome.resumed !== undefined) {
        resumed.push(result.outcome.resumed);
      }
    }

    const warnings = await step('warnings', async () => this.warnings(notionLogin));
    const warnedDays = warnings?.warnedDays;

    notionLogin = warnings?.notionLogin ?? notionLogin;

    await step('record', () => health.write('cron', { ok: failedSteps.length === 0, ranAt }));

    const ok = failedSteps.length === 0;

    try {
      await (ok ? heartbeat.ok() : heartbeat.fail());
    } catch (error) {
      logger.warn('heartbeat.failed', { error });
    }

    const report: DailyReport = {
      autoStart,
      failedSteps,
      ok,
      probes,
      resumed,
      watchdog,
      ...(notionLogin === undefined ? {} : { notionLogin }),
      ...(warnedDays === undefined ? {} : { warnedDays }),
    };

    logger.info('cron.done', { ...report });

    return report;
  }

  private async autoStart(
    active: { readonly job: BackupJob } | undefined,
  ): Promise<AutoStartOutcome> {
    const { autoStart, clock, service, timeZone } = this.options;

    if (!autoStart.enabled) {
      return 'disabled';
    }

    if (!isAutoStartDue(clock.now(), timeZone, autoStart.dayOfMonth)) {
      return 'not_due';
    }

    if (active !== undefined) {
      return 'active_job';
    }

    const { created } = await service.start({ kind: 'scheduled', reason: 'daily cron' });

    return created ? 'started' : 'exists';
  }

  /**
   * The login a probe's last recorded failure showed gone, if any. A timeout is recorded too, so
   * a login failure right after one counts as new: at most one more `lost` a day, by the gate.
   */
  private async lostBefore(name: ProbeName): Promise<LoginService | undefined> {
    const snapshot = await this.options.health.read();
    const previous = {
      drive: snapshot.driveRoot?.code,
      google: snapshot.google?.code,
      notion: snapshot.notionSession?.code,
    }[name];

    return previous === undefined ? undefined : loginServiceOf(previous);
  }

  /**
   * One probe, then what follows from it: a pass resumes a job waiting for that login; a login
   * found gone that this probe did not already find gone sends one `lost` warning. The Drive
   * probe failing on the Google token reports Google; the 24 h gate keeps that to one message.
   */
  private async probeAndWatch(name: ProbeName): Promise<{
    readonly code?: ErrorCode;
    readonly notionLogin?: NotionLoginRequestOutcome;
    readonly resumed?: string;
  }> {
    const lostBefore = await this.lostBefore(name);
    const waiting = await this.options.jobs.findActive();
    const report = await this.probes.probe(name);

    if (report.ok) {
      const job = await resumeAfterLoginFix(
        { job: waiting?.job, logger: this.options.logger, service: this.options.service },
        PROBE_SERVICE[name],
      );

      return job === undefined ? {} : { resumed: job.id };
    }

    // A Notion session found gone asks for the automatic login first; its worker reports the
    // outcome, so `lost` waits for a failure. A login refused (one a day) or not queued sends
    // `lost` even if this probe found it gone before: the login's own report may never have
    // come. `JobNotifications` keeps that to one a day.
    const notionLogin = isNotionGone(report) ? await this.requestLogin('expired') : undefined;

    if (notionLogin === 'queued') {
      return { code: report.code, notionLogin };
    }

    const lost = loginServiceOf(report.code);
    const loginStuck = notionLogin === 'refused' || notionLogin === 'failed';

    if (lost !== undefined && (lost !== lostBefore || loginStuck)) {
      await this.options.warnings.lost(lost);
    }

    return {
      code: report.code,
      ...(notionLogin === undefined || notionLogin === 'disabled' ? {} : { notionLogin }),
    };
  }

  /**
   * The automatic login, if configured. A failed request (the gate's Redis) is logged and
   * reported as `failed`, so the warning it replaced still goes out.
   */
  private async requestLogin(trigger: NotionLoginTrigger): Promise<NotionLoginRequestOutcome> {
    const { autoLogin, logger } = this.options;

    if (autoLogin === undefined) {
      return 'disabled';
    }

    try {
      return await autoLogin.request(trigger);
    } catch (error) {
      logger.error('notion.login.request_failed', { error, trigger });

      return 'failed';
    }
  }

  /**
   * The Notion expiry warning, or within the warning days the automatic renewal ahead of time:
   * the warning is sent only if the renewal cannot be queued (refused, off, or failed). A login
   * a probe queued in this run stands for both.
   */
  private async warnings(probeLogin: NotionLoginRequestOutcome | undefined): Promise<{
    readonly notionLogin?: NotionLoginRequestOutcome;
    readonly warnedDays?: number;
  }> {
    const { notionLogin: sessionInfo, warnings } = this.options;
    const expiresAt = await sessionInfo.authCookieExpiresAt();

    if (probeLogin === 'queued') {
      return {};
    }

    let notionLogin: NotionLoginRequestOutcome | undefined;

    if (warnings.notionExpiryDue(expiresAt) !== undefined) {
      notionLogin = await this.requestLogin('expiring');

      if (notionLogin === 'queued') {
        return { notionLogin };
      }
    }

    const warnedDays = await warnings.notionExpiring(expiresAt);

    return {
      ...(notionLogin === undefined || notionLogin === 'disabled' ? {} : { notionLogin }),
      ...(warnedDays === undefined ? {} : { warnedDays }),
    };
  }

  /** Google and Drive daily; Notion on its probe days, or while the active job waits for it. */
  private probesDue(active: BackupJob | undefined): ProbeName[] {
    const { autoStart, clock, timeZone } = this.options;
    const notionDue =
      isNotionProbeDay(clock.now(), timeZone, autoStart.dayOfMonth) ||
      (active !== undefined && awaitedLogin(active) === 'notion');

    return notionDue ? ['google', 'drive', 'notion'] : ['google', 'drive'];
  }

  /**
   * The active job's wakeup, if it was lost, and its lifetime: both through `backup_process`'s
   * path, so the new token is published and saved under the control lease, and the tick it
   * wakes ends an expired job with its `failure` notification.
   */
  private async watchdog(
    active: { readonly job: BackupJob } | undefined,
  ): Promise<WatchdogOutcome> {
    if (active === undefined) {
      return 'idle';
    }

    const { job } = active;
    const now = this.options.clock.now();
    const expired = isLifetimeExceeded(job, now, this.options.policy);

    if (!expired && !isStuck(job, now)) {
      return 'on_schedule';
    }

    const result = await this.options.service.process(job.id, 'watchdog');

    this.options.logger.info('cron.watchdog', { expired, jobId: job.id, queued: result.queued });

    if (!result.queued) {
      return result.reason === 'leased' ? 'leased' : 'on_schedule';
    }

    return expired ? 'lifetime' : 'rearmed';
  }
}

/** The Notion probe found the saved session signed out: the case an automatic login fixes. */
function isNotionGone(report: ProbeReport): boolean {
  return report.probe === 'notion' && !report.ok && report.code === 'NOTION_SESSION_EXPIRED';
}

/**
 * Due for a wakeup that never came: something is due (it neither ended nor waits for you), and
 * no wakeup is saved, or the saved one is more than an hour late.
 */
export function isStuck(job: BackupJob, now: Date): boolean {
  if (nextWakeupDelaySec(job) === undefined) {
    return false;
  }

  return (
    job.schedule === undefined ||
    now.getTime() - Date.parse(job.schedule.notBefore) > STUCK_AFTER_MS
  );
}
