import type {
  BackupQuery,
  BackupStorage,
  BackupUpload,
  SidecarOutcome,
  StoredBackup,
  UploadedBackup,
} from '../../application/ports.js';
import { sha256SidecarName } from '../../domain/naming.js';
import type { Period } from '../../domain/period.js';
import { digestsOf } from '../../shared/digests.js';
import type { Logger } from '../../shared/logger.js';
import type { Sleep } from '../../shared/sleep.js';
import { systemSleep } from '../../shared/sleep.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { ROOT_APP_PROPERTY } from './drive-access-check.js';
import { backupProperties, errorCode, hasProperty, listDriveFiles } from './drive-common.js';
import { DriveFolders } from './drive-folders.js';
import type { DriveFile } from './drive-schemas.js';
import { driveQueryString, ZIP_MIME_TYPE } from './drive-schemas.js';
import type { DriveUploadMetadata, ResumableUploader } from './resumable-upload.js';
import { bytesSource, openFileSource } from './resumable-upload.js';
import { VerifiedUploader } from './verified-upload.js';

const BACKUP_FIELDS = 'id,name,size,sha256Checksum,appProperties,createdTime';

export interface DriveBackupStorageOptions {
  api: GoogleApiClient;
  /** `APP_ENV=dev`: every folder and file goes under the app-created `_dev` folder. */
  devFolder: boolean;
  logger: Logger;
  rootFolderId: string;
  sleep?: Sleep;
  uploader: ResumableUploader;
  /** `WRITE_SHA256_SIDECAR`: write `<name>.zip.sha256` next to each ZIP. */
  writeSidecar: boolean;
}

/**
 * `BackupStorage` on Drive REST v3 with `drive.file`: verified ZIPs (and their `.sha256`
 * sidecars) in the year folders `DriveFolders` finds or creates. A ZIP counts as stored only
 * when Drive's own SHA-256 matches the one recorded in its `appProperties`.
 */
export class DriveBackupStorage implements BackupStorage {
  private readonly folders: DriveFolders;
  private readonly verifiedUploader: VerifiedUploader;

  constructor(private readonly options: DriveBackupStorageOptions) {
    const { api, devFolder, logger, rootFolderId, sleep = systemSleep, uploader } = options;

    this.folders = new DriveFolders({ api, devFolder, logger, rootFolderId });
    this.verifiedUploader = new VerifiedUploader({ api, logger, sleep, uploader });
  }

  async checkAccess(signal?: AbortSignal): Promise<void> {
    await this.folders.readRoot(signal);
  }

  /** The S6 outcome: `app-owned` when `drive:init` created the root, else `existing`. */
  async rootMode(signal?: AbortSignal): Promise<'app-owned' | 'existing'> {
    const root = await this.folders.readRoot(signal);

    return root.appProperties?.[ROOT_APP_PROPERTY] === 'true' ? 'app-owned' : 'existing';
  }

  ensureYearFolder(period: Period, signal?: AbortSignal): Promise<string> {
    return this.folders.ensureYearFolder(period, signal);
  }

  async findExisting(query: BackupQuery, signal?: AbortSignal): Promise<StoredBackup | undefined> {
    const yearFolderId = await this.folders.findYearFolder(query.period, signal);

    return yearFolderId === undefined ? undefined : this.findIn(yearFolderId, query, signal);
  }

  async upload({
    content,
    fileName,
    jobId,
    period,
    signal,
  }: BackupUpload): Promise<UploadedBackup> {
    signal?.throwIfAborted();

    const yearFolderId = await this.ensureYearFolder(period, signal);
    const target: UploadTarget = { fileName, jobId, period, yearFolderId };
    const existing = await this.findIn(yearFolderId, { period, sha256: content.sha256 }, signal);

    if (existing !== undefined) {
      return this.reused(existing, signal);
    }

    const source = await openFileSource(content.path);
    let fileId: string;

    try {
      fileId = await this.verifiedUploader.upload(
        zipMetadata(target, content.sha256),
        source,
        { sha256: content.sha256, sizeBytes: source.size },
        signal,
      );
    } finally {
      await source.close();
    }

    return this.uploaded(storedBackup(target, fileId, content.sha256, source.size), signal);
  }

  /** The sidecar, written once per ZIP; a failure leaves the stored ZIP in place. */
  private async ensureSidecar(
    backup: StoredBackup,
    signal: AbortSignal | undefined,
  ): Promise<SidecarOutcome> {
    if (!this.options.writeSidecar) {
      return 'disabled';
    }

    const name = sha256SidecarName(backup.fileName);

    try {
      // Name and digest together: two ZIPs with the same bytes but different names each get one.
      const existing = await listDriveFiles(
        this.options.api,
        [
          `${driveQueryString(backup.yearFolderId)} in parents`,
          'trashed = false',
          `name = ${driveQueryString(name)}`,
          hasProperty(backupProperties.sidecarOf, backup.sha256),
        ],
        'id,name',
        signal,
      );

      if (existing.some((file) => file.name === name)) {
        return 'exists';
      }

      // The `shasum -a 256 -c` format: the digest, two spaces, the file name.
      const bytes = Buffer.from(`${backup.sha256}  ${backup.fileName}\n`);

      await this.verifiedUploader.upload(
        {
          appProperties: { [backupProperties.sidecarOf]: backup.sha256 },
          mimeType: 'text/plain',
          name,
          parents: [backup.yearFolderId],
        },
        bytesSource(bytes),
        digestsOf(bytes),
        signal,
      );

      return 'written';
    } catch (error) {
      // An abort ends the whole upload; only other failures leave the sidecar to a later run.
      signal?.throwIfAborted();

      this.options.logger.warn('drive.sidecar.failed', {
        code: errorCode(error),
        driveFileId: backup.driveFileId,
      });

      return 'failed';
    }
  }

  /** The newest verified backup in the year folder. Unverified candidates are logged and skipped. */
  private async findIn(
    yearFolderId: string,
    { jobId, period, sha256 }: BackupQuery,
    signal?: AbortSignal,
  ): Promise<StoredBackup | undefined> {
    const files = await listDriveFiles(
      this.options.api,
      [
        `${driveQueryString(yearFolderId)} in parents`,
        'trashed = false',
        `mimeType = ${driveQueryString(ZIP_MIME_TYPE)}`,
        hasProperty(backupProperties.period, period),
        ...(sha256 === undefined ? [] : [hasProperty(backupProperties.sha256, sha256)]),
        ...(jobId === undefined ? [] : [hasProperty(backupProperties.jobId, jobId)]),
      ],
      BACKUP_FIELDS,
      signal,
    );
    const verified: { backup: StoredBackup; createdMs: number }[] = [];

    for (const file of files) {
      const backup = verifiedBackup(file, yearFolderId);

      if (
        backup === undefined ||
        file.appProperties?.[backupProperties.period] !== period ||
        (sha256 !== undefined && backup.sha256 !== sha256) ||
        (jobId !== undefined && backup.jobId !== jobId)
      ) {
        this.options.logger.warn('drive.backup.unverified', { driveFileId: file.id });
        continue;
      }

      verified.push({ backup, createdMs: Date.parse(file.createdTime ?? '') || 0 });
    }

    return verified.toSorted((a, b) => b.createdMs - a.createdMs)[0]?.backup;
  }

  /** A new ZIP in Drive, verified. */
  private async uploaded(
    backup: StoredBackup,
    signal: AbortSignal | undefined,
  ): Promise<UploadedBackup> {
    this.options.logger.info('drive.backup.uploaded', {
      driveFileId: backup.driveFileId,
      sizeBytes: backup.sizeBytes,
    });

    return { ...backup, sidecar: await this.ensureSidecar(backup, signal), uploaded: true };
  }

  /** A verified copy was already in Drive. */
  private async reused(
    existing: StoredBackup,
    signal: AbortSignal | undefined,
  ): Promise<UploadedBackup> {
    this.options.logger.info('drive.backup.exists', { driveFileId: existing.driveFileId });

    return { ...existing, sidecar: await this.ensureSidecar(existing, signal), uploaded: false };
  }
}

/** Where a ZIP goes, and the job it belongs to. */
interface UploadTarget {
  readonly fileName: string;
  readonly jobId: string;
  readonly period: Period;
  readonly yearFolderId: string;
}

function storedBackup(
  { fileName, jobId, yearFolderId }: UploadTarget,
  driveFileId: string,
  sha256: string,
  sizeBytes: number,
): StoredBackup {
  return { driveFileId, fileName, jobId, sha256, sizeBytes, yearFolderId };
}

function zipMetadata(
  { fileName, jobId, period, yearFolderId }: UploadTarget,
  sha256: string,
): DriveUploadMetadata {
  return {
    appProperties: {
      [backupProperties.jobId]: jobId,
      [backupProperties.period]: period,
      [backupProperties.sha256]: sha256,
    },
    mimeType: ZIP_MIME_TYPE,
    name: fileName,
    parents: [yearFolderId],
  };
}

/** A backup whose recorded SHA-256 Drive's own checksum confirms; else undefined. */
function verifiedBackup(file: DriveFile, yearFolderId: string): StoredBackup | undefined {
  const sha256 = file.appProperties?.[backupProperties.sha256];
  const jobId = file.appProperties?.[backupProperties.jobId];

  if (
    sha256 === undefined ||
    jobId === undefined ||
    file.sha256Checksum !== sha256 ||
    file.name === undefined ||
    file.size === undefined
  ) {
    return undefined;
  }

  return {
    driveFileId: file.id,
    fileName: file.name,
    jobId,
    sha256,
    sizeBytes: file.size,
    yearFolderId,
  };
}
