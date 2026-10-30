/** The limits the state machine enforces. Production values come from the env tuning variables. */
export interface BackupPolicy {
  /** `EMAIL_WAIT_TIMEOUT_HOURS`: after this long without an email, a new export attempt starts. */
  readonly emailWaitTimeoutHours: number;
  /** `JOB_MAX_LIFETIME_HOURS`: a job older than this becomes `FAILED`. */
  readonly jobMaxLifetimeHours: number;
  /** `MAX_EXPORT_ATTEMPTS`: export requests per job, including the first. */
  readonly maxExportAttempts: number;
  /** `MAX_STAGE_RETRIES`: backoff retries of a `stage`-budget error before it needs attention. */
  readonly maxStageRetries: number;
}

export const defaultBackupPolicy: BackupPolicy = {
  emailWaitTimeoutHours: 48,
  jobMaxLifetimeHours: 168,
  maxExportAttempts: 3,
  maxStageRetries: 3,
};

/** Export emails arrived 3 to 12 minutes after the request, so this long means something is off. */
export const LATE_EMAIL_AFTER_MINUTES = 45;

/** Transfer runs per email: the first run and one retry, whatever stopped the first. */
export const MAX_TRANSFER_RUNS = 2;
