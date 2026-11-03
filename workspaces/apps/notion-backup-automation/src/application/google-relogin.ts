import type { BackupJob } from '../domain/job.js';
import type { Logger } from '../shared/logger.js';
import { ApplicationError } from './application-error.js';
import type { BackupApplicationService } from './backup-service.js';
import type { JobNotifications } from './job-notifications.js';
import { loginFixes, resumeAfterLoginFix } from './login-watch.js';
import type { JobRepository } from './ports.js';
import type { ProbeReport, ProbeRunner } from './probe-runner.js';

export interface GoogleReloginOptions {
  readonly jobs: Pick<JobRepository, 'findActive'>;
  readonly logger: Logger;
  readonly notifications: Pick<JobNotifications, 'loginWarning'>;
  readonly probes: Pick<ProbeRunner, 'probe'>;
  readonly service: Pick<BackupApplicationService, 'retryIncident'>;
}

export interface GoogleReloginReport {
  readonly drive: ProbeReport;
  readonly google: ProbeReport;
  /**
   * The job that waited for the Google login but was not retried: another invocation held it or
   * changed it meanwhile. The next daily cron resumes it if it still waits.
   */
  readonly pendingJobId?: string;
  /** The job that waited for the Google login and was retried. */
  readonly resumedJobId?: string;
}

/**
 * What follows a phone re-login that stored a new refresh token: the Google and Drive probes on
 * it, run at once and recorded as the daily cron records them. Once the Google probe passes, the
 * job that waited for the Google login resumes and "Google access renewed" is sent; otherwise
 * the failure stays recorded for `backup_health` and nothing claims a renewal. A busy job does
 * not undo the renewal: it stays waiting for the next daily cron.
 */
export class GoogleRelogin {
  private readonly options: GoogleReloginOptions;

  constructor(options: GoogleReloginOptions) {
    this.options = options;
  }

  async afterRenewal(): Promise<GoogleReloginReport> {
    const { jobs, logger, notifications, probes } = this.options;
    // Read before the probes, so an incident raised meanwhile is left alone.
    const waiting = await jobs.findActive();
    // At once, as the daily cron runs them: the slower budget (Drive's 60 s) bounds the wait, not
    // their sum, so the callback ends well inside its function's limit (`vercel.json`).
    const [google, drive] = await Promise.all([probes.probe('google'), probes.probe('drive')]);

    if (!google.ok) {
      logger.warn('google.relogin.unverified', { code: google.code });

      return { drive, google };
    }

    const resume = await this.resume(waiting?.job);

    await notifications.loginWarning({
      howToFix: loginFixes.google,
      kind: 'renewed',
      service: 'google',
    });
    logger.info('google.relogin.done', { driveOk: drive.ok, ...resume });

    return { drive, google, ...resume };
  }

  /**
   * Retries the job that waited for Google. The token is saved and verified by now, so a job
   * that another invocation holds (`INVALID_STATE`: a worker, or a Retry tap) is left waiting,
   * and the daily cron's Google probe resumes it.
   */
  private async resume(
    job: BackupJob | undefined,
  ): Promise<Pick<GoogleReloginReport, 'pendingJobId' | 'resumedJobId'>> {
    const { logger, service } = this.options;

    try {
      const resumed = await resumeAfterLoginFix({ job, logger, service }, 'google');

      return resumed === undefined ? {} : { resumedJobId: resumed.id };
    } catch (error) {
      const busy = error instanceof ApplicationError && error.code === 'INVALID_STATE';

      if (job === undefined || !busy) {
        throw error;
      }

      logger.warn('google.relogin.resume_deferred', { jobId: job.id });

      return { pendingJobId: job.id };
    }
  }
}
