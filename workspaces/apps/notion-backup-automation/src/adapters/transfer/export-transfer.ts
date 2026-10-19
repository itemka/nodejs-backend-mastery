import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { IntegrationError } from '../../application/integration-error.js';
import type {
  BackupStorage,
  ExportEmailFinder,
  ExportTransfer,
  SecretStore,
  StoredSecret,
  TransferRequest,
  TransferResult,
} from '../../application/ports.js';
import { jobIdSchema } from '../../domain/naming.js';
import { abortable } from '../../shared/abortable.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import { EnvelopeError } from '../../shared/envelope-crypto.js';
import type { Logger } from '../../shared/logger.js';
import { SecretValue } from '../../shared/secret-value.js';
import { cookieHeaderFor, parseSessionCookies } from './download-cookies.js';
import type { DownloadTarget, HttpDownloader } from './http-downloader.js';
import { verifyZipArchive } from './zip-archive-verifier.js';

/** `/tmp/nba` on Vercel. Only the transfer writes here, and only one job is active at a time. */
export const DEFAULT_TRANSFER_DIRECTORY = path.join(tmpdir(), 'nba');

export interface TmpExportTransferOptions {
  clock?: Clock;
  /** Holds the ZIP during a run; removed with everything in it before and after each run. */
  directory?: string;
  downloader: HttpDownloader;
  emailFinder: Pick<ExportEmailFinder, 'getDownloadLink'>;
  /** Logs sizes, counts, durations and Drive IDs only: never a URL, cookie or entry name. */
  logger: Logger;
  secrets: Pick<SecretStore, 'get'>;
  storage: Pick<BackupStorage, 'upload'>;
}

/**
 * `ExportTransfer` in `TRANSFER_MODE=tmp`, the Phase 0 choice: the ZIP is downloaded to
 * `<directory>/<jobId>.zip`, checked entry by entry, then uploaded from the file. Nothing stays
 * in the directory after a run, whether it completes, fails or is aborted.
 */
export class TmpExportTransfer implements ExportTransfer {
  private readonly clock: Clock;
  private readonly directory: string;
  private readonly downloader: HttpDownloader;
  private readonly emailFinder: Pick<ExportEmailFinder, 'getDownloadLink'>;
  private readonly logger: Logger;
  private readonly secrets: Pick<SecretStore, 'get'>;
  private readonly storage: Pick<BackupStorage, 'upload'>;

  constructor({
    clock = systemClock,
    directory = DEFAULT_TRANSFER_DIRECTORY,
    downloader,
    emailFinder,
    logger,
    secrets,
    storage,
  }: TmpExportTransferOptions) {
    this.clock = clock;
    this.directory = directory;
    this.downloader = downloader;
    this.emailFinder = emailFinder;
    this.logger = logger;
    this.secrets = secrets;
    this.storage = storage;
  }

  /**
   * The link is checked before anything is downloaded: an expired one ends the run with
   * `link_expired` and no request to Notion's file host, and so does a refusal after the expiry.
   */
  async run({
    emailMessageId,
    fileName,
    jobId,
    onStep,
    period,
    signal,
  }: TransferRequest): Promise<TransferResult> {
    signal?.throwIfAborted();

    // The ID names the ZIP in the directory, so it must never be a path.
    if (!jobIdSchema.safeParse(jobId).success) {
      throw new RangeError('Expected a job ID such as 2026-10');
    }

    try {
      const link = await abortable(this.emailFinder.getDownloadLink(emailMessageId), signal);
      const target = await this.downloader.resolve(link, signal);

      if (target.expiresAt.getTime() <= this.clock.now().getTime()) {
        return this.linkExpired(target);
      }

      const cookieHeader = await this.cookieHeader(target.url.reveal(), signal);

      await onStep?.('DOWNLOADING');
      await this.resetDirectory();

      const zipPath = path.join(this.directory, `${jobId}.zip`);
      let started = this.clock.now().getTime();
      const downloaded = await this.downloader.download({
        cookieHeader,
        path: zipPath,
        signal,
        target,
      });

      if (downloaded.outcome === 'link_expired') {
        return this.linkExpired(target);
      }

      const { sha256, sizeBytes } = downloaded.digests;

      this.logger.info('transfer.download.done', { durationMs: this.since(started), sizeBytes });
      await onStep?.('VERIFYING');
      started = this.clock.now().getTime();

      const { entryCount, uncompressedBytes } = await verifyZipArchive(zipPath, signal);

      this.logger.info('transfer.verify.done', {
        durationMs: this.since(started),
        entryCount,
        uncompressedBytes,
      });
      await onStep?.('UPLOADING');
      started = this.clock.now().getTime();

      const backup = await this.storage.upload({
        content: { kind: 'file', path: zipPath, sha256 },
        fileName,
        jobId,
        period,
        ...(signal === undefined ? {} : { signal }),
      });

      this.logger.info('transfer.upload.done', {
        driveFileId: backup.driveFileId,
        durationMs: this.since(started),
        sidecar: backup.sidecar,
        uploaded: backup.uploaded,
      });

      return { backup, entryCount, outcome: 'stored' };
    } finally {
      await this.removeDirectory();
    }
  }

  /**
   * The `Cookie` header for Notion's file host, from the saved session. A missing, unreadable or
   * cookie-less session is `NOTION_SESSION_EXPIRED`: `auth:notion` saves a new one.
   */
  private async cookieHeader(
    url: URL,
    signal: AbortSignal | undefined,
  ): Promise<SecretValue<string>> {
    let session: StoredSecret | undefined;

    try {
      session = await abortable(this.secrets.get('notion-storage-state'), signal);
    } catch (error) {
      if (error instanceof EnvelopeError) {
        throw new IntegrationError(
          'NOTION_SESSION_EXPIRED',
          `The saved Notion session cannot be opened (${error.code})`,
        );
      }

      throw error;
    }

    if (session === undefined) {
      throw new IntegrationError('NOTION_SESSION_EXPIRED', 'No Notion session is saved');
    }

    const header = cookieHeaderFor(parseSessionCookies(session.value), url, this.clock.now());

    if (header === undefined) {
      throw new IntegrationError(
        'NOTION_SESSION_EXPIRED',
        `The saved Notion session has no unexpired cookie for ${url.hostname}`,
      );
    }

    return new SecretValue(header);
  }

  private linkExpired(target: DownloadTarget): TransferResult {
    this.logger.info('transfer.link.expired', { expiresAt: target.expiresAt.toISOString() });

    return { outcome: 'link_expired' };
  }

  /** A failure is logged, not thrown: it must not hide the run's own result or error. */
  private async removeDirectory(): Promise<void> {
    try {
      await rm(this.directory, { force: true, recursive: true });
    } catch (error) {
      this.logger.warn('transfer.cleanup.failed', {
        code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
      });
    }
  }

  /** Removes what a killed earlier run left behind, so the free-space check sees all of it. */
  private async resetDirectory(): Promise<void> {
    await rm(this.directory, { force: true, recursive: true });
    await mkdir(this.directory, { mode: 0o700, recursive: true });
  }

  private since(startedMs: number): number {
    return this.clock.now().getTime() - startedMs;
  }
}
