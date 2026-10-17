import { z } from 'zod';

/**
 * How a failure is retried before it needs attention:
 * - `stage`: up to `MAX_STAGE_RETRIES` backoff retries (Notion and the browser);
 * - `window`: backoff retries for about 24 h of consecutive failures (Google APIs, the download);
 * - `none`: never retried automatically.
 */
export type RetryBudget = 'none' | 'stage' | 'window';

export interface ErrorDefinition {
  /** Static text: safe to store, log, return from MCP and send to the model. */
  readonly description: string;
  readonly howToFix: string;
  readonly retry: RetryBudget;
  /**
   * Whether the supervisor triages the incident before the user is told. Retried codes reach it
   * only after their retries are exhausted.
   */
  readonly supervised: boolean;
}

const retryLater =
  'Wait for the service to recover; the job retries by itself, or run backup_retry.';
const checkLogs = 'Check the logs and events for this job, then run backup_retry.';

/** Every error code the job can record. Messages never contain runtime data. */
export const errorCatalog = {
  BROWSER_LAUNCH_FAILED: {
    description: 'Chromium failed to start.',
    howToFix: checkLogs,
    retry: 'stage',
    supervised: true,
  },
  CONFIG_INCOMPLETE: {
    description: 'A required environment variable is missing or invalid.',
    howToFix: 'Run doctor, fix the variable in Vercel, redeploy, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  DOWNLOAD_FAILED: {
    description: 'The ZIP download failed with a network or server error.',
    howToFix: retryLater,
    retry: 'window',
    supervised: true,
  },
  DOWNLOAD_LINK_EXPIRED: {
    description: 'The export download link expired, and no export attempt is left.',
    howToFix: 'Cancel this job, then run backup_start with force to request a new export.',
    retry: 'none',
    supervised: true,
  },
  DRIVE_CHECKSUM_MISMATCH: {
    description: 'The checksum Drive reported did not match the downloaded ZIP.',
    howToFix: 'Check the uploaded file in Drive, then run backup_retry.',
    retry: 'none',
    supervised: true,
  },
  DRIVE_ROOT_INACCESSIBLE: {
    description: 'The Drive backup folder or its year folder is not visible or not writable.',
    howToFix: 'Run drive:check and restore the folder access, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  DRIVE_UNAVAILABLE: {
    description: 'The Drive API failed or rate-limited the request.',
    howToFix: retryLater,
    retry: 'window',
    supervised: true,
  },
  EMAIL_TIMEOUT: {
    description: 'No export email arrived within the wait limit, and no export attempt is left.',
    howToFix:
      'Check that Notion email notifications are on and the Gmail inbox, then run backup_retry.',
    retry: 'none',
    supervised: true,
  },
  EMAIL_UNRECOGNIZED: {
    description: 'An export email did not match the expected format or download link.',
    howToFix: 'Update the export email parser, then run backup_retry.',
    retry: 'none',
    supervised: true,
  },
  GMAIL_UNAVAILABLE: {
    description: 'The Gmail API failed or rate-limited the request.',
    howToFix: retryLater,
    retry: 'window',
    supervised: true,
  },
  GOOGLE_AUTH_REQUIRED: {
    description: 'Google rejected the refresh token, or a required scope is missing.',
    howToFix:
      'Run auth:google, update GOOGLE_REFRESH_TOKEN in Vercel, redeploy, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  INTEGRATION_UNCLASSIFIED: {
    description: 'An external service returned a response the app does not classify.',
    howToFix: checkLogs,
    retry: 'none',
    supervised: true,
  },
  JOB_LIFETIME_EXCEEDED: {
    description: 'The job exceeded its maximum lifetime.',
    howToFix: 'Run backup_start with force to try this period again.',
    retry: 'none',
    supervised: false,
  },
  NOTION_INTERACTIVE_CHALLENGE: {
    description: 'Notion showed a CAPTCHA or a verification page.',
    howToFix: 'Run auth:notion, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  NOTION_SESSION_EXPIRED: {
    description: 'The saved Notion session is no longer signed in.',
    howToFix: 'Run auth:notion, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  NOTION_UI_CHANGED: {
    description: 'The Notion Settings page did not match the expected layout.',
    howToFix: 'Update the Notion Settings page object, then run backup_retry.',
    retry: 'none',
    supervised: true,
  },
  NOTION_UNAVAILABLE: {
    description: 'Notion did not load in time or returned a server error.',
    howToFix: retryLater,
    retry: 'stage',
    supervised: true,
  },
  NOTION_WRONG_WORKSPACE: {
    description: 'The signed-in Notion account does not show the configured workspace.',
    howToFix:
      'Check NOTION_WORKSPACE_URL and NOTION_WORKSPACE_NAME, run auth:notion, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  STATE_SCHEMA_INVALID: {
    description: 'A stored job record failed schema validation.',
    howToFix: 'Inspect the job record in Redis, then repair or delete it.',
    retry: 'none',
    supervised: false,
  },
  TMP_SPACE_INSUFFICIENT: {
    description: 'Not enough /tmp space for the ZIP.',
    howToFix: 'Set TRANSFER_MODE=stream, redeploy, then run backup_retry.',
    retry: 'none',
    supervised: false,
  },
  TRANSFER_TIMEOUT: {
    description: 'The transfer did not finish within one invocation.',
    howToFix: 'Set TRANSFER_MODE=stream or check the ZIP size, then run backup_retry.',
    retry: 'none',
    supervised: true,
  },
  UNKNOWN_ERROR: {
    description: 'An unexpected error occurred.',
    howToFix: checkLogs,
    retry: 'none',
    supervised: true,
  },
  ZIP_INVALID: {
    description: 'The downloaded file is not a valid ZIP archive.',
    howToFix: 'Check the export in Notion, then run backup_retry.',
    retry: 'none',
    supervised: true,
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof errorCatalog;

// Object.keys loses the key type; the catalog is the only source of codes.
export const errorCodes = Object.keys(errorCatalog) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(errorCodes);

export function describeError(code: ErrorCode): ErrorDefinition {
  return errorCatalog[code];
}
