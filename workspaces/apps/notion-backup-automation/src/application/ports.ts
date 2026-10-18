import type { JobEvent } from '../domain/job-event.js';
import type { FoundEmail } from '../domain/job-lifecycle.js';
import type { BackupJob } from '../domain/job.js';
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
