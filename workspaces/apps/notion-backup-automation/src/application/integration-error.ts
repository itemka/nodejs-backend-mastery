import type { ErrorCode } from '../domain/error-catalog.js';
import { describeError } from '../domain/error-catalog.js';

export interface IntegrationErrorOptions {
  /** A `Retry-After` from the failed call, in seconds. */
  retryAfterSec?: number;
  /** `NOTION_UI_CHANGED`: the Settings dialog's ARIA `role:name` pairs, already redacted. */
  uiLandmarks?: readonly string[];
}

/**
 * A port call that failed with a cataloged code. The job records the code; the message is
 * static text plus status codes, never a URL, token, email content or response body.
 */
export class IntegrationError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterSec: number | undefined;
  readonly uiLandmarks: readonly string[] | undefined;

  constructor(code: ErrorCode, detail?: string, options: IntegrationErrorOptions = {}) {
    super(detail ?? describeError(code).description);
    this.name = 'IntegrationError';
    this.code = code;
    this.retryAfterSec = options.retryAfterSec;
    this.uiLandmarks = options.uiLandmarks;
  }
}
