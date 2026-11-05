import type { ErrorCode } from '../domain/error-catalog.js';
import { IntegrationError } from './integration-error.js';

/**
 * Why an automatic Notion login stopped. Static labels only: safe to log, store in `health` and
 * show in `backup_health`; the details stay in the logs.
 * - `browser`: Chromium did not start;
 * - `challenge`: Notion showed a CAPTCHA or a verification page; never retried in the attempt;
 * - `code_unrecognized`: a trusted login email held no single code;
 * - `email_ambiguous`: several trusted login emails arrived: someone else asked Notion for a
 *   code for this address, so the one this login asked for cannot be told apart;
 * - `email_missing`: no trusted login email arrived within the wait;
 * - `error`: anything unclassified;
 * - `gmail`: the Gmail API failed;
 * - `google_auth`: Google rejected the token, so Gmail cannot be read;
 * - `no_file_cookie`: signed in, but without the file host's cookie the download needs;
 * - `no_identity`: no saved browser identity to replay (S7 replayed it);
 * - `not_signed_in`: the code was typed, but the app never rendered;
 * - `owner_mismatch`: `OWNER_GOOGLE_EMAIL` is not the Gmail profile's address;
 * - `password_prompt`: Notion asked for a password instead of sending a code;
 * - `timeout`: the login's budget ran out;
 * - `ui_changed`: the login page did not show the expected fields;
 * - `unavailable`: Notion did not load or answered 5xx;
 * - `wrong_workspace`: signed in, but the switcher shows another workspace.
 */
export const notionLoginFailures = [
  'browser',
  'challenge',
  'code_unrecognized',
  'email_ambiguous',
  'email_missing',
  'error',
  'gmail',
  'google_auth',
  'no_file_cookie',
  'no_identity',
  'not_signed_in',
  'owner_mismatch',
  'password_prompt',
  'timeout',
  'ui_changed',
  'unavailable',
  'wrong_workspace',
] as const;

export type NotionLoginFailure = (typeof notionLoginFailures)[number];

/** A step of the automatic Notion login failed; the message is static text. */
export class NotionLoginError extends Error {
  readonly failure: NotionLoginFailure;

  constructor(failure: NotionLoginFailure, message: string) {
    super(message);
    this.name = 'NotionLoginError';
    this.failure = failure;
  }
}

/** The shared adapters' cataloged failures, as the login reports them. */
const FAILURE_OF_CODE: Readonly<Partial<Record<ErrorCode, NotionLoginFailure>>> = {
  BROWSER_LAUNCH_FAILED: 'browser',
  GMAIL_UNAVAILABLE: 'gmail',
  GOOGLE_AUTH_REQUIRED: 'google_auth',
  NOTION_INTERACTIVE_CHALLENGE: 'challenge',
  NOTION_SESSION_EXPIRED: 'not_signed_in',
  NOTION_UI_CHANGED: 'ui_changed',
  NOTION_UNAVAILABLE: 'unavailable',
  NOTION_WRONG_WORKSPACE: 'wrong_workspace',
};

/** Classifies whatever ended a login; an aborted `signal` is the budget running out. */
export function notionLoginFailureOf(error: unknown, signal?: AbortSignal): NotionLoginFailure {
  if (error instanceof NotionLoginError) {
    return error.failure;
  }

  if (signal?.aborted === true) {
    return 'timeout';
  }

  if (error instanceof IntegrationError) {
    return FAILURE_OF_CODE[error.code] ?? 'error';
  }

  return 'error';
}
