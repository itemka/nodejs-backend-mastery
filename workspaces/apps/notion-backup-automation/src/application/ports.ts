import type { JobEvent } from '../domain/job-event.js';
import type { FoundEmail } from '../domain/job-lifecycle.js';
import type { BackupJob } from '../domain/job.js';
import type { Period } from '../domain/period.js';
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
export type ExportEmailRejection =
  | 'authentication'
  | 'consumed'
  | 'recipient'
  | 'sender'
  | 'stale'
  | 'subject'
  | 'type';

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
 * The ZIP to upload:
 * - `file`: a verified file, with the SHA-256 the verifier computed (`TRANSFER_MODE=tmp`);
 * - `stream`: bytes hashed while they are uploaded (`TRANSFER_MODE=stream`).
 */
export type BackupContent =
  | { readonly kind: 'file'; readonly path: string; readonly sha256: string }
  | { readonly kind: 'stream'; readonly stream: AsyncIterable<Uint8Array> };

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
  /**
   * Set when a streamed upload duplicated this stored backup and Drive refused to delete the
   * duplicate. It carries no SHA-256 mark, so it is never adopted; delete it in Drive.
   */
  readonly leftoverFileId?: string;
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
 * used.
 */
export interface BackupStorage {
  /** The root is a visible, writable folder. */
  checkAccess(): Promise<void>;
  /** The period's year folder, found by its exact name or created; returns its ID. */
  ensureYearFolder(period: Period): Promise<string>;
  /** The newest verified backup of the period, of that job and SHA-256 when they are given. */
  findExisting(query: BackupQuery): Promise<StoredBackup | undefined>;
  /**
   * Uploads the ZIP, unless a verified copy with the same SHA-256 exists (for a stream, the
   * duplicate is deleted once its SHA-256 is known). It succeeds only once Drive's SHA-256
   * matches. Otherwise the new file is deleted: `DRIVE_CHECKSUM_MISMATCH` on a mismatch.
   */
  upload(request: BackupUpload): Promise<UploadedBackup>;
}
