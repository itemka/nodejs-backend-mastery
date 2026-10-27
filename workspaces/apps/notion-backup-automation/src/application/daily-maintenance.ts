import type { ErrorCode } from '../domain/error-catalog.js';
import { isLifetimeExceeded } from '../domain/job-lifecycle.js';
import type { BackupJob } from '../domain/job.js';
import { isAutoStartDue, isNotionProbeDay, periodFor } from '../domain/period.js';
import type { BackupPolicy } from '../domain/policy.js';
import { nextWakeupDelaySec } from '../domain/schedule-policy.js';
import { abortable } from '../shared/abortable.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { BackupApplicationService } from './backup-service.js';
import type { HealthSnapshot } from './health-snapshot.js';
import { IntegrationError } from './integration-error.js';
import type { LoginWarnings } from './login-watch.js';
import { awaitedLogin, loginServiceOf, resumeAfterLoginFix } from './login-watch.js';
import type {
  HealthProbes,
  HealthStore,
  JobRepository,
  LoginService,
  NotionLoginInfo,
  Heartbeat,
} from './ports.js';

export const probeNames = ['drive', 'google', 'notion'] as const;

export type ProbeName = (typeof probeNames)[number];

export function isProbeName(value: string): value is ProbeName {
  return (probeNames as readonly string[]).includes(value);
}

/** A probe's time; the Notion one opens Settings in Chromium (S2: about 35 s on Vercel). */
const PROBE_BUDGET_MS: Readonly<Record<ProbeName, number>> = {
  drive: 60_000,
  google: 30_000,
  notion: 120_000,
};

/** A budget that ran out is the service being slow, not access being lost. */
const PROBE_TIMEOUT_CODE: Readonly<Record<ProbeName, ErrorCode>> = {
  drive: 'DRIVE_UNAVAILABLE',
  google: 'GMAIL_UNAVAILABLE',
  notion: 'NOTION_UNAVAILABLE',
};

/** Which login or access each probe's pass proves. */
const PROBE_SERVICE: Readonly<Record<ProbeName, LoginService>> = {
  drive: 'drive',
  google: 'google',
  notion: 'notion',
};

/** QStash delivers on time; a wakeup this late was lost, so the watchdog publishes it again. */
export const STUCK_AFTER_MS = 60 * 60 * 1000;

type NotionState = NonNullable<HealthSnapshot['notionSession']>['state'];

/** The answer to `?probe=`: content-free, as `backup_health` shows it. */
export type ProbeReport =
  | {
      readonly authCookieExpiresAt?: string;
      readonly exportDialog: 'in_progress' | 'ready';
      readonly notionSession: 'valid';
      readonly ok: true;
      readonly probe: 'notion';
    }
  | {
      readonly code: ErrorCode;
      readonly notionSession?: NotionState;
      readonly ok: false;
      readonly probe: ProbeName;
    }
  | { readonly mode: 'app-owned' | 'existing'; readonly ok: true; readonly probe: 'drive' }
  | { readonly ok: true; readonly probe: 'google'; readonly scopes: readonly string[] };

export type AutoStartOutcome = 'active_job' | 'disabled' | 'exists' | 'not_due' | 'started';

/**
 * - `idle`: no active job;
 * - `on_schedule`: its next wakeup is not overdue, or it waits for you;
 * - `rearmed`: an overdue job got a new wakeup; `lifetime`: an expired one was woken to end;
 * - `leased`: a worker is on it.
 */
export type WatchdogOutcome = 'idle' | 'leased' | 'lifetime' | 'on_schedule' | 'rearmed';

export interface DailyReport {
  readonly autoStart: AutoStartOutcome | 'failed';
  /** The sub-steps that threw; any one sends the heartbeat's `/fail`. */
  readonly failedSteps: readonly string[];
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
  readonly warnings: Pick<LoginWarnings, 'lost' | 'notionExpiring'>;
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
  private readonly options: DailyMaintenanceOptions;

  constructor(options: DailyMaintenanceOptions) {
    this.options = options;
  }

  /**
   * One probe, recorded in `health`; `?probe=` runs only this. A probe's own failure is its
   * result; failing to record it (Redis) throws.
   */
  async probe(name: ProbeName): Promise<ProbeReport> {
    const checkedAt = this.options.clock.now().toISOString();
    const signal = AbortSignal.timeout(PROBE_BUDGET_MS[name]);
    let report: ProbeReport;

    try {
      report = await this.runProbe(name, signal);
    } catch (error) {
      const code = probeCode(error, name, signal);

      this.options.logger.warn('cron.probe.failed', { code, probe: name });
      report =
        name === 'notion'
          ? { code, notionSession: notionStateFor(code), ok: false, probe: name }
          : { code, ok: false, probe: name };
    }

    await this.record(report, checkedAt);

    return report;
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

      if (result.outcome.resumed !== undefined) {
        resumed.push(result.outcome.resumed);
      }
    }

    const warnedDays = await step('warnings', async () =>
      this.options.warnings.notionExpiring(await this.options.notionLogin.authCookieExpiresAt()),
    );

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
  private async probeAndWatch(
    name: ProbeName,
  ): Promise<{ readonly code?: ErrorCode; readonly resumed?: string }> {
    const lostBefore = await this.lostBefore(name);
    const waiting = await this.options.jobs.findActive();
    const report = await this.probe(name);

    if (report.ok) {
      const job = await resumeAfterLoginFix(
        { job: waiting?.job, logger: this.options.logger, service: this.options.service },
        PROBE_SERVICE[name],
      );

      return job === undefined ? {} : { resumed: job.id };
    }

    const lost = loginServiceOf(report.code);

    if (lost !== undefined && lost !== lostBefore) {
      await this.options.warnings.lost(lost);
    }

    return { code: report.code };
  }

  /** Google and Drive daily; Notion on its probe days, or while the active job waits for it. */
  private probesDue(active: BackupJob | undefined): ProbeName[] {
    const { autoStart, clock, timeZone } = this.options;
    const notionDue =
      isNotionProbeDay(clock.now(), timeZone, autoStart.dayOfMonth) ||
      (active !== undefined && awaitedLogin(active) === 'notion');

    return notionDue ? ['google', 'drive', 'notion'] : ['google', 'drive'];
  }

  /** The probe's result in its `health` field: the pass's facts, or the failure's code. */
  private async record(report: ProbeReport, checkedAt: string): Promise<void> {
    const { health } = this.options;

    if (!report.ok) {
      const { code } = report;

      switch (report.probe) {
        case 'drive': {
          await health.write('driveRoot', { checkedAt, code, ok: false });

          return;
        }

        case 'google': {
          await health.write('google', { checkedAt, code, scopes: [], tokenOk: false });

          return;
        }

        case 'notion': {
          await health.write('notionSession', { checkedAt, code, state: notionStateFor(code) });

          return;
        }
      }
    }

    switch (report.probe) {
      case 'drive': {
        await health.write('driveRoot', { checkedAt, mode: report.mode, ok: true });

        return;
      }

      case 'google': {
        await health.write('google', { checkedAt, scopes: [...report.scopes], tokenOk: true });

        return;
      }

      case 'notion': {
        await health.write('notionSession', {
          checkedAt,
          exportDialog: report.exportDialog,
          state: 'valid',
          ...(report.authCookieExpiresAt === undefined
            ? {}
            : { authCookieExpiresAt: report.authCookieExpiresAt }),
        });
      }
    }
  }

  /** The probe itself, within its budget; a failure throws. */
  private async runProbe(name: ProbeName, signal: AbortSignal): Promise<ProbeReport> {
    const { clock, probes, timeZone } = this.options;

    switch (name) {
      case 'drive': {
        const { mode } = await abortable(
          probes.drive(periodFor(clock.now(), timeZone), signal),
          signal,
        );

        return { mode, ok: true, probe: name };
      }

      case 'google': {
        const { scopes } = await abortable(probes.google(signal), signal);

        return { ok: true, probe: name, scopes };
      }

      case 'notion': {
        const result = await abortable(probes.notion(signal), signal);

        return { ...result, notionSession: 'valid', ok: true, probe: name };
      }
    }
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

function probeCode(error: unknown, name: ProbeName, signal: AbortSignal): ErrorCode {
  if (error instanceof IntegrationError) {
    return error.code;
  }

  return signal.aborted ? PROBE_TIMEOUT_CODE[name] : 'UNKNOWN_ERROR';
}

function notionStateFor(code: ErrorCode): NotionState {
  switch (code) {
    case 'NOTION_INTERACTIVE_CHALLENGE': {
      return 'challenge';
    }

    case 'NOTION_SESSION_EXPIRED': {
      return 'expired';
    }

    default: {
      return 'error';
    }
  }
}
