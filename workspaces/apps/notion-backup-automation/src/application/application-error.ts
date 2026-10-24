/** The application errors the MCP tools and the Telegram buttons report. */
export type ApplicationErrorCode = 'ACTIVE_JOB_EXISTS' | 'INVALID_STATE' | 'JOB_NOT_FOUND';

/** A request the current state refuses. The message is static text plus job IDs and statuses. */
export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  /** The job the error is about: for `ACTIVE_JOB_EXISTS`, the active one. */
  readonly jobId: string | undefined;

  constructor(code: ApplicationErrorCode, message: string, jobId?: string) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.jobId = jobId;
  }
}
