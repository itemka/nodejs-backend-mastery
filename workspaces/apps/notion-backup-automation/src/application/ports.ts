import type { ErrorCode } from '../domain/error-catalog.js';
import type { ExportShrink } from '../domain/export-size.js';
import type { JobEvent } from '../domain/job-event.js';
import type { FoundEmail } from '../domain/job-lifecycle.js';
import type { BackupJob, exportEmailRejections } from '../domain/job.js';
import type { Period } from '../domain/period.js';
import type { Stage, TransferMarker } from '../domain/statuses.js';
import type { EnvelopeMeta } from '../shared/envelope-crypto.js';
import type { SecretValue } from '../shared/secret-value.js';
import type { HealthField, HealthSnapshot } from './health-snapshot.js';

/** A job record with the version its compare-and-set updates are checked against. */
export interface StoredJob {
  readonly job: BackupJob;
  readonly version: number;
}

/**
 * - `created`: the job is stored with version 1 and is now the active job.
 * - `exists`: a job with this ID already exists (for a normal job: the period's job); it is returned.
 * - `active_exists`: another job is active, so nothing was created.
 */
export type CreateJobResult =
  | { readonly activeJobId: string; readonly outcome: 'active_exists' }
  | { readonly outcome: 'created'; readonly stored: StoredJob }
  | { readonly outcome: 'exists'; readonly stored: StoredJob };

export type UpdateJobResult =
  | { readonly outcome: 'conflict'; readonly version: number }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'updated'; readonly version: number };

export type LeaseResult =
  | { readonly acquired: false; readonly remainingMs: number }
  | { readonly acquired: true };

/** Job state. Every write is atomic; every read and write is checked against the job schema. */
export interface JobRepository {
  /** Acquires `lease:<jobId>` for `ttlMs` unless another worker holds it. */
  acquireLease(jobId: string, workerId: string, ttlMs: number): Promise<LeaseResult>;
  /** Appends to the job's event history, keeping the newest `MAX_JOB_EVENTS`. */
  appendEvent(jobId: string, event: JobEvent): Promise<void>;
  /**
   * Creates a CREATED job, unless its ID exists or another job is active. One active job overall
   * and one normal job per period follow from this.
   */
  create(job: BackupJob): Promise<CreateJobResult>;
  /** The active job, if any. */
  findActive(): Promise<StoredJob | undefined>;
  get(jobId: string): Promise<StoredJob | undefined>;
  /** The newest jobs first. */
  list(options: { limit: number }): Promise<StoredJob[]>;
  /** The newest `limit` events, oldest first. */
  listEvents(jobId: string, options: { limit: number }): Promise<JobEvent[]>;
  /**
   * Claims a Gmail message for a job (`email:<messageId>` NX) and returns the job that owns it:
   * this job, also when it claimed the email before, or the job that claimed it first.
   */
  markEmailConsumed(messageId: string, jobId: string): Promise<{ ownerJobId: string }>;
  /** Releases the lease only if `workerId` still holds it. */
  releaseLease(jobId: string, workerId: string): Promise<boolean>;
  /**
   * Compare-and-set: writes `next` only if the stored version is `expectedVersion`. A terminal
   * status also clears the active-job pointer.
   */
  update(jobId: string, expectedVersion: number, next: BackupJob): Promise<UpdateJobResult>;
}

export type SecretName = 'notion-storage-state';

export interface StoredSecret {
  readonly createdAt: string;
  readonly meta: EnvelopeMeta;
  readonly value: string;
}

/** Secrets encrypted at rest with `APP_ENCRYPTION_KEY`. */
export interface SecretStore {
  get(name: SecretName): Promise<StoredSecret | undefined>;
  put(name: SecretName, value: string, meta?: EnvelopeMeta): Promise<void>;
}

/** The last result of each health probe. */
export interface HealthStore {
  read(): Promise<HealthSnapshot>;
  write<F extends HealthField>(field: F, value: NonNullable<HealthSnapshot[F]>): Promise<void>;
}

/**
 * Google access tokens for Gmail and Drive, kept in memory. Throws `IntegrationError`
 * `GOOGLE_AUTH_REQUIRED` when the refresh token is rejected or a required scope is missing.
 */
export interface GoogleTokenProvider {
  getAccessToken(): Promise<string>;
}

/** Why a search hit is not the export email. None of these reveal the email's content. */
export type ExportEmailRejection = (typeof exportEmailRejections)[number];

export interface ExportEmailSearch {
  /** Emails already consumed by this or another job. */
  excludeIds: readonly string[];
  /** When the export was requested; the search starts 10 minutes earlier. */
  requestedAfter: Date;
}

export type ExportEmailSearchResult =
  | {
      readonly rejected: Readonly<Partial<Record<ExportEmailRejection, number>>>;
      readonly status: 'not_found';
    }
  | { readonly email: FoundEmail; readonly status: 'found' };

/**
 * Finds Notion's "export ready" email. A trusted email whose download link cannot be read
 * throws `IntegrationError` `EMAIL_UNRECOGNIZED`.
 */
export interface ExportEmailFinder {
  /** The newest trusted export email after `requestedAfter − 10 min`, if one has arrived. */
  findReadyEmail(search: ExportEmailSearch): Promise<ExportEmailSearchResult>;
  /**
   * Re-reads the email and returns its Mailgun download link. The link is as sensitive as the
   * signed file URL it redirects to: it is never stored, logged or returned.
   */
  getDownloadLink(messageId: string): Promise<SecretValue<string>>;
}

/** A backup ZIP in Drive whose content Drive's checksum confirms. */
export interface StoredBackup {
  readonly driveFileId: string;
  readonly fileName: string;
  /** The job that uploaded it. */
  readonly jobId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly yearFolderId: string;
}

/**
 * The ZIP to upload: a verified file, with the SHA-256 the verifier computed
 * (`TRANSFER_MODE=tmp`). S4 showed that `/tmp` holds a 250 MiB ZIP, so no streamed upload exists.
 */
export interface BackupContent {
  readonly kind: 'file';
  readonly path: string;
  readonly sha256: string;
}

export interface BackupUpload {
  readonly content: BackupContent;
  /** `notion-workspace-YYYY-MM-DD.zip`. */
  readonly fileName: string;
  readonly jobId: string;
  readonly period: Period;
  /** Stops the upload, such as when the transfer runs out of time. */
  readonly signal?: AbortSignal;
}

/**
 * The `.sha256` sidecar after an upload:
 * - `written` or `exists`: it is in Drive;
 * - `disabled`: `WRITE_SHA256_SIDECAR=false`;
 * - `failed`: the ZIP is stored, but the sidecar is not (logged).
 */
export type SidecarOutcome = 'disabled' | 'exists' | 'failed' | 'written';

export interface UploadedBackup extends StoredBackup {
  readonly sidecar: SidecarOutcome;
  /** False when Drive already held a verified copy with the same SHA-256. */
  readonly uploaded: boolean;
}

export interface BackupQuery {
  readonly jobId?: string;
  readonly period: Period;
  readonly sha256?: string;
}

/**
 * Backup ZIPs in Drive, under `<root>/<YYYY>/`, or `<root>/_dev/<YYYY>/` for `APP_ENV=dev`. A
 * file counts as a backup only when Drive's SHA-256 matches the one the app recorded on it.
 * Throws `IntegrationError` `DRIVE_ROOT_INACCESSIBLE` when the root or a year folder cannot be
 * used. An aborted `signal` ends any call with its reason.
 */
export interface BackupStorage {
  /** The root is a visible, writable folder. */
  checkAccess(signal?: AbortSignal): Promise<void>;
  /**
   * The period's year folder, found by its exact name or created; returns its ID. In a root the
   * app did not create, only a year after every visible year folder is created.
   */
  ensureYearFolder(period: Period, signal?: AbortSignal): Promise<string>;
  /** The newest verified backup of the period, of that job and SHA-256 when they are given. */
  findExisting(query: BackupQuery, signal?: AbortSignal): Promise<StoredBackup | undefined>;
  /**
   * Uploads the ZIP, unless a verified copy with the same SHA-256 exists (for a stream, the
   * duplicate is deleted once its SHA-256 is known). It succeeds only once Drive's SHA-256
   * matches. Otherwise the new file is deleted: `DRIVE_CHECKSUM_MISMATCH` on a mismatch.
   */
  upload(request: BackupUpload): Promise<UploadedBackup>;
}

/**
 * The saved Notion session passed the session gate: the workspace page rendered signed in and
 * its switcher shows `NOTION_WORKSPACE_NAME`. `authCookieExpiresAt` is the earliest expiry of
 * its sign-in cookies, when they have one.
 */
export interface SessionProbe {
  readonly authCookieExpiresAt?: string;
  readonly state: 'valid';
}

/**
 * - `confirmed`: Notion showed its "Exporting" message after the final click;
 * - `already_in_progress`: Notion showed an export already running, so nothing was clicked;
 * - `in_doubt`: the final click was sent, but no confirmation was seen. The job waits for the
 *   email as for `confirmed`, and never clicks again in this attempt.
 */
export type ExportTriggerOutcome = 'already_in_progress' | 'confirmed' | 'in_doubt';

export interface ExportRequest {
  /**
   * Called once, immediately before the final Export click, so the job saves `exportClickAt`
   * first. A rejection stops the run before the click. Not called for `already_in_progress`.
   */
  readonly onBeforeFinalClick: () => Promise<void>;
  /**
   * Stops the run. Before the final click, including while `onBeforeFinalClick` runs, the call
   * rejects with the signal's reason and sends no click; after it, the signal only ends the wait
   * for the confirmation.
   */
  readonly signal?: AbortSignal;
}

/**
 * Requests the official workspace export in Notion's Settings, with the saved session. Failures
 * before the final click throw `IntegrationError`: `NOTION_SESSION_EXPIRED`,
 * `NOTION_INTERACTIVE_CHALLENGE`, `NOTION_WRONG_WORKSPACE`, `NOTION_UI_CHANGED`,
 * `NOTION_UNAVAILABLE` or `BROWSER_LAUNCH_FAILED`. Nothing throws after the final click.
 */
export interface NotionExportTrigger {
  /** Runs the session gate only; nothing in Settings is opened or clicked. */
  probeSession(signal?: AbortSignal): Promise<SessionProbe>;
  requestExport(request: ExportRequest): Promise<{ readonly outcome: ExportTriggerOutcome }>;
}

export interface TransferRequest {
  /** The export email the job claimed. */
  readonly emailMessageId: string;
  /** `notion-workspace-YYYY-MM-DD.zip`. */
  readonly fileName: string;
  readonly jobId: string;
  /**
   * Called before each step (DOWNLOADING, VERIFYING, UPLOADING), so the job saves the progress
   * marker before the work starts. A rejection stops the run.
   */
  readonly onStep?: (marker: TransferMarker) => Promise<void>;
  readonly period: Period;
  /** The transfer budget: an abort ends the run with the signal's reason. */
  readonly signal?: AbortSignal;
}

/**
 * - `stored`: the ZIP passed its checks and Drive's SHA-256 matches; `entryCount` is the number
 *   of files in it;
 * - `link_expired`: the link's `expirationTimestamp` passed before or during the download, so
 *   nothing was stored.
 */
export type TransferResult =
  | { readonly backup: UploadedBackup; readonly entryCount: number; readonly outcome: 'stored' }
  | { readonly outcome: 'link_expired' };

/**
 * Moves one export ZIP from the email's download link to Drive within one invocation: the link,
 * the download with the saved Notion session's cookies, the ZIP check, and the verified upload.
 * Temporary files are deleted whatever the outcome. Failures throw `IntegrationError`, such as
 * `NOTION_SESSION_EXPIRED`, `DOWNLOAD_FAILED`, `TMP_SPACE_INSUFFICIENT`, `ZIP_INVALID` or a
 * `BackupStorage` code; an aborted signal ends the run with its reason.
 */
export interface ExportTransfer {
  run(request: TransferRequest): Promise<TransferResult>;
}

export const wakeupReasons = [
  'manual',
  'retry',
  'schedule',
  'start',
  'supervisor',
  'watchdog',
] as const;

/** Why a wakeup was published; QStash shows it per message. */
export type WakeupReason = (typeof wakeupReasons)[number];

export interface Wakeup {
  /** 0 for an immediate wakeup. */
  readonly delaySec: number;
  readonly jobId: string;
  readonly reason: WakeupReason;
  /** The job's schedule token; a delivery whose token is no longer the job's is stale. */
  readonly token: string;
}

/**
 * Publishes delayed, signed wakeups of the worker. A publish with the same job and token is
 * delivered once (`<jobId>.<token>` deduplication), so retrying a publish is safe.
 */
export interface Scheduler {
  /** Best effort: a superseded message that still arrives is stale and does nothing. */
  cancel(messageId: string): Promise<void>;
  /** Throws when the wakeup may not have been published; the caller keeps the old token. */
  schedule(wakeup: Wakeup): Promise<{ readonly messageId?: string }>;
}

/** One line of a job's sanitized event history, as notifications show it. */
export interface NotificationEventLine {
  readonly at: string;
  readonly text: string;
}

export interface SuccessNotification {
  readonly driveFileId: string;
  /** From the job's creation to its completion. */
  readonly durationMs: number;
  readonly entryCount?: number;
  readonly fileName: string;
  /** The folder under the Drive root: `2026`, or `_dev/2026` for `APP_ENV=dev`. */
  readonly folder: string;
  readonly jobId: string;
  readonly period: Period;
  /** Set when the backup is much smaller than the last completed one. */
  readonly shrink?: ExportShrink;
  readonly sizeBytes: number;
}

/** The job ended as FAILED: its lifetime ran out. */
export interface FailureNotification {
  readonly code: ErrorCode;
  readonly jobId: string;
  readonly period: Period;
  /** The catalog description of `code`. */
  readonly reason: string;
  readonly stage: Stage;
}

/** The job waits for a person. Every text field is static catalog text or sanitized events. */
export interface AttentionNotification {
  readonly code: ErrorCode;
  readonly howToFix: string;
  readonly jobId: string;
  readonly period: Period;
  readonly reason: string;
  /** The newest sanitized events, oldest first; at most 10. */
  readonly recentEvents: readonly NotificationEventLine[];
  /** Whether a new export attempt is still allowed (`exportAttempt < MAX_EXPORT_ATTEMPTS`). */
  readonly retryFromScratch: boolean;
  readonly stage: Stage;
  readonly supervisorSummary?: string;
}

/** `drive` is the backup folder's access (`drive:check`), apart from the Google sign-in itself. */
export type LoginService = 'drive' | 'google' | 'notion';

/**
 * - `expiring`: the recorded Notion sign-in expires within the warning days;
 * - `lost`: a probe found the access gone;
 * - `renewed`: the access was renewed without the Mac (Phases 13 and 14).
 */
export interface LoginWarningNotification {
  readonly daysLeft?: number;
  /** Notion only: Google refresh tokens have no expiry date. */
  readonly expiresAt?: string;
  readonly howToFix: string;
  readonly kind: 'expiring' | 'lost' | 'renewed';
  readonly service: LoginService;
}

/**
 * Delivers notifications to one channel (console, Telegram). A delivery may throw;
 * `CompositeNotifier` logs the failure, so no notification ever fails a tick or the cron.
 */
export interface Notifier {
  attention(notification: AttentionNotification): Promise<void>;
  failure(notification: FailureNotification): Promise<void>;
  loginWarning(notification: LoginWarningNotification): Promise<void>;
  success(notification: SuccessNotification): Promise<void>;
}

/**
 * Marks a notification as sent for `ttlSec`, so a repeat within that time is skipped: an
 * `attention` once per job and code per 24 h, a `lost` login warning once per service per 24 h.
 */
export interface NotificationGate {
  /** True for the first claim of `key` within `ttlSec`, false while an earlier claim lives. */
  claim(key: string, ttlSec: number): Promise<boolean>;
}

/** At most `limit` uses per fixed window of `windowSec`. */
export interface RateLimit {
  readonly limit: number;
  readonly windowSec: number;
}

export type RateLimitResult =
  | { readonly allowed: false; readonly retryAfterSec: number }
  | { readonly allowed: true };

/** Counts uses across every function instance, such as `/mcp` requests per hour. */
export interface RateLimiter {
  /** Counts one use of `name` in the current window; refused once `limit` uses are counted. */
  take(name: string, limit: RateLimit): Promise<RateLimitResult>;
}

/** The saved Notion session's facts, read without opening a browser. */
export interface NotionLoginInfo {
  /** The earliest sign-in cookie expiry; undefined when none is recorded or no session is saved. */
  authCookieExpiresAt(): Promise<string | undefined>;
}

/** The Notion probe passed: signed in, export dialog reached, saved file cookie unexpired. */
export interface NotionProbeResult {
  readonly authCookieExpiresAt?: string;
  /** `in_progress`: Notion showed an export already running instead of the dialog. */
  readonly exportDialog: 'in_progress' | 'ready';
}

/** The Google probe passed: a token refreshed with these scopes, and Gmail answered. */
export interface GoogleProbeResult {
  /** Short names, such as `gmail.readonly`. */
  readonly scopes: readonly string[];
}

/** The Drive probe passed: the root and the period's year folder resolved, and `_dev` is writable. */
export interface DriveProbeResult {
  /** `app-owned` when `drive:init` created the root (S6 fallback 2). */
  readonly mode: 'app-owned' | 'existing';
}

/**
 * The daily cron's checks of each dependency, the same ones the backup uses. A failure throws
 * `IntegrationError` with its cataloged code; nothing is clicked, uploaded or kept.
 */
export interface HealthProbes {
  /** Resolves the period's year folder, then creates and deletes a probe file under `_dev`. */
  drive(period: Period, signal?: AbortSignal): Promise<DriveProbeResult>;
  google(signal?: AbortSignal): Promise<GoogleProbeResult>;
  /** The gate and export dialog (cancelled), then the saved download cookie after refresh. */
  notion(signal?: AbortSignal): Promise<NotionProbeResult>;
}

/** The outside "is the app alive" check (healthchecks.io). It never throws. */
export interface Heartbeat {
  /** A cron sub-step threw. */
  fail(): Promise<void>;
  ok(): Promise<void>;
}
