import { setTimeout as sleepFor } from 'node:timers/promises';

import { IntegrationError } from '../../application/integration-error.js';
import type {
  BackupQuery,
  BackupStorage,
  BackupUpload,
  SidecarOutcome,
  StoredBackup,
  UploadedBackup,
} from '../../application/ports.js';
import { DEV_FOLDER_NAME, sha256SidecarName, yearFolderName } from '../../domain/naming.js';
import type { Period } from '../../domain/period.js';
import type { Digests } from '../../shared/digests.js';
import { digestsOf } from '../../shared/digests.js';
import type { Logger } from '../../shared/logger.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { GoogleApiError } from '../google/google-api-client.js';
import type { DriveFile } from './drive-schemas.js';
import {
  DRIVE_API_URL,
  DRIVE_FOLDER_MIME_TYPE,
  driveFileListSchema,
  driveFileSchema,
  driveIdSchema,
  driveQueryString,
  ZIP_MIME_TYPE,
} from './drive-schemas.js';
import type { DriveUploadMetadata, ResumableUploader, UploadSource } from './resumable-upload.js';
import { bytesSource, HashingStreamSource, openFileSource } from './resumable-upload.js';

/** `appProperties` keys. They are private to this app: no other app or user sees them. */
export const backupProperties = {
  /** On the `_dev` folder. */
  devFolder: 'notionBackupDev',
  jobId: 'notionBackupJobId',
  period: 'notionBackupPeriod',
  /** The SHA-256 of the ZIP, which Drive's own checksum must match. */
  sha256: 'notionBackupSha256',
  /** On a `.sha256` sidecar: the SHA-256 of the ZIP it describes. */
  sidecarOf: 'notionBackupSidecarOf',
  /** On a year folder the app created. */
  year: 'notionBackupYear',
} as const;

const BACKUP_FIELDS = 'id,name,size,sha256Checksum,md5Checksum,appProperties,createdTime';
const CHECKSUM_FIELDS = 'id,size,sha256Checksum,md5Checksum';
const MAX_LIST_PAGES = 10;
/** Drive may report the checksums a moment after the upload; it is asked this often. */
const CHECKSUM_READS = 3;
const CHECKSUM_READ_DELAY_MS = 1000;

/**
 * Drive refuses a folder the app cannot see or write with these: 404, or 403 for a missing
 * `drive.file` grant or permission. Other 403s, such as a full Drive, stay unclassified.
 */
const accessDeniedReasons = new Set(['appNotAuthorizedToFile', 'insufficientFilePermissions']);

export interface DriveBackupStorageOptions {
  api: GoogleApiClient;
  /** `APP_ENV=dev`: every folder and file goes under the app-created `_dev` folder. */
  devFolder: boolean;
  logger: Logger;
  rootFolderId: string;
  sleep?: (ms: number) => Promise<void>;
  uploader: ResumableUploader;
  /** `WRITE_SHA256_SIDECAR`: write `<name>.zip.sha256` next to each ZIP. */
  writeSidecar: boolean;
}

/**
 * `BackupStorage` on Drive REST v3 with `drive.file`. Year folders are found by exact name
 * under the root (the S6 "existing" mode finds your picked `2026` folder), or created with
 * `appProperties.notionBackupYear` (later years, the app-owned root, `_dev`). The root must be
 * visible first: without the S6 grant a second `2026` folder would appear next to yours.
 */
export class DriveBackupStorage implements BackupStorage {
  private readonly api: GoogleApiClient;
  /** The root, or `_dev` in it, once resolved. */
  private baseFolderId: string | undefined;
  private readonly devFolder: boolean;
  private readonly logger: Logger;
  private readonly rootFolderId: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly uploader: ResumableUploader;
  private readonly writeSidecar: boolean;

  constructor({
    api,
    devFolder,
    logger,
    rootFolderId,
    sleep = (ms) => sleepFor(ms),
    uploader,
    writeSidecar,
  }: DriveBackupStorageOptions) {
    this.api = api;
    this.devFolder = devFolder;
    this.logger = logger;
    this.rootFolderId = driveIdSchema.parse(rootFolderId);
    this.sleep = sleep;
    this.uploader = uploader;
    this.writeSidecar = writeSidecar;
  }

  async checkAccess(): Promise<void> {
    let root: DriveFile;

    try {
      root = await this.api.json(driveFileSchema, {
        query: {
          fields: 'id,mimeType,trashed,capabilities(canAddChildren)',
          supportsAllDrives: true,
        },
        url: `${DRIVE_API_URL}/files/${this.rootFolderId}`,
      });
    } catch (error) {
      throw accessError(error, 'The backup root is not visible');
    }

    if (root.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
      throw inaccessible('The backup root is not a folder');
    }

    if (root.trashed === true) {
      throw inaccessible('The backup root is in the trash');
    }

    if (root.capabilities?.canAddChildren === false) {
      throw inaccessible('The backup root is not writable');
    }
  }

  async ensureYearFolder(period: Period): Promise<string> {
    const baseId = await this.resolveBase(true);
    const year = yearFolderName(period);

    return (
      (await this.findFolder(baseId, year)) ??
      (await this.createFolder(baseId, year, { [backupProperties.year]: year }))
    );
  }

  async findExisting(query: BackupQuery): Promise<StoredBackup | undefined> {
    const baseId = await this.resolveBase(false);

    if (baseId === undefined) {
      return undefined;
    }

    const yearFolderId = await this.findFolder(baseId, yearFolderName(query.period));

    return yearFolderId === undefined ? undefined : this.findIn(yearFolderId, query);
  }

  async upload({
    content,
    fileName,
    jobId,
    period,
    signal,
  }: BackupUpload): Promise<UploadedBackup> {
    const yearFolderId = await this.ensureYearFolder(period);
    const properties = { [backupProperties.jobId]: jobId, [backupProperties.period]: period };
    let stored: StoredBackup;

    if (content.kind === 'file') {
      const existing = await this.findIn(yearFolderId, { period, sha256: content.sha256 });

      if (existing !== undefined) {
        this.logger.info('drive.backup.exists', { driveFileId: existing.driveFileId });

        return {
          ...existing,
          sidecar: await this.ensureSidecar(existing, signal),
          uploaded: false,
        };
      }

      const source = await openFileSource(content.path);

      try {
        const digests = { md5: content.md5, sha256: content.sha256, sizeBytes: source.size };
        const fileId = await this.uploadVerified(
          zipMetadata(fileName, yearFolderId, {
            ...properties,
            [backupProperties.sha256]: content.sha256,
          }),
          source,
          () => digests,
          signal,
        );

        stored = {
          driveFileId: fileId,
          fileName,
          jobId,
          sha256: content.sha256,
          sizeBytes: source.size,
          yearFolderId,
        };
      } finally {
        await source.close();
      }
    } else {
      const source = new HashingStreamSource(content.stream);

      try {
        // The SHA-256 is known only at the end, so it is recorded after Drive's check.
        const fileId = await this.uploadVerified(
          zipMetadata(fileName, yearFolderId, properties),
          source,
          () => source.digests(),
          signal,
        );
        const { sha256, sizeBytes } = source.digests();

        await this.recordSha256(fileId, sha256);
        stored = { driveFileId: fileId, fileName, jobId, sha256, sizeBytes, yearFolderId };
      } finally {
        await source.close();
      }
    }

    this.logger.info('drive.backup.uploaded', {
      driveFileId: stored.driveFileId,
      sizeBytes: stored.sizeBytes,
    });

    return { ...stored, sidecar: await this.ensureSidecar(stored, signal), uploaded: true };
  }

  private async createFolder(
    parentId: string,
    name: string,
    appProperties: Record<string, string>,
  ): Promise<string> {
    try {
      const folder = await this.api.json(driveFileSchema, {
        body: { appProperties, mimeType: DRIVE_FOLDER_MIME_TYPE, name, parents: [parentId] },
        method: 'POST',
        query: { fields: 'id', supportsAllDrives: true },
        url: `${DRIVE_API_URL}/files`,
      });

      this.logger.info('drive.folder.created', { folderId: folder.id, name });

      return folder.id;
    } catch (error) {
      throw accessError(error, `Cannot create the ${name} folder`);
    }
  }

  /** Deletes a file the app just uploaded; false when it could not. */
  private async deleteUploaded(fileId: string): Promise<boolean> {
    try {
      await this.api.send({
        method: 'DELETE',
        query: { supportsAllDrives: true },
        url: `${DRIVE_API_URL}/files/${fileId}`,
      });

      return true;
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        return true;
      }

      this.logger.warn('drive.upload.delete_failed', {
        code: errorCode(error),
        driveFileId: fileId,
      });

      return false;
    }
  }

  /** The sidecar, written once per ZIP; a failure leaves the stored ZIP in place. */
  private async ensureSidecar(
    backup: StoredBackup,
    signal: AbortSignal | undefined,
  ): Promise<SidecarOutcome> {
    if (!this.writeSidecar) {
      return 'disabled';
    }

    try {
      const existing = await this.list(
        [
          `${driveQueryString(backup.yearFolderId)} in parents`,
          'trashed = false',
          hasProperty(backupProperties.sidecarOf, backup.sha256),
        ],
        'id',
      );

      if (existing.length > 0) {
        return 'exists';
      }

      // The `shasum -a 256 -c` format: the digest, two spaces, the file name.
      const bytes = Buffer.from(`${backup.sha256}  ${backup.fileName}\n`);
      const digests = digestsOf(bytes);

      await this.uploadVerified(
        {
          appProperties: { [backupProperties.sidecarOf]: backup.sha256 },
          mimeType: 'text/plain',
          name: sha256SidecarName(backup.fileName),
          parents: [backup.yearFolderId],
        },
        bytesSource(bytes),
        () => digests,
        signal,
      );

      return 'written';
    } catch (error) {
      this.logger.warn('drive.sidecar.failed', {
        code: errorCode(error),
        driveFileId: backup.driveFileId,
      });

      return 'failed';
    }
  }

  private async findFolder(parentId: string, name: string): Promise<string | undefined> {
    const listed = await this.list(
      [
        `${driveQueryString(parentId)} in parents`,
        'trashed = false',
        `mimeType = ${driveQueryString(DRIVE_FOLDER_MIME_TYPE)}`,
        `name = ${driveQueryString(name)}`,
      ],
      'id,name',
    );
    const folders = listed.filter((folder) => folder.name === name);

    if (folders.length > 1) {
      throw inaccessible(`${folders.length} folders named ${name}; only one may exist`);
    }

    return folders[0]?.id;
  }

  /** The newest verified backup in the year folder. Unverified candidates are logged and skipped. */
  private async findIn(
    yearFolderId: string,
    { jobId, period, sha256 }: BackupQuery,
  ): Promise<StoredBackup | undefined> {
    const files = await this.list(
      [
        `${driveQueryString(yearFolderId)} in parents`,
        'trashed = false',
        `mimeType = ${driveQueryString(ZIP_MIME_TYPE)}`,
        hasProperty(backupProperties.period, period),
        ...(sha256 === undefined ? [] : [hasProperty(backupProperties.sha256, sha256)]),
        ...(jobId === undefined ? [] : [hasProperty(backupProperties.jobId, jobId)]),
      ],
      BACKUP_FIELDS,
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
        this.logger.warn('drive.backup.unverified', { driveFileId: file.id });
        continue;
      }

      verified.push({ backup, createdMs: Date.parse(file.createdTime ?? '') || 0 });
    }

    return verified.toSorted((a, b) => b.createdMs - a.createdMs)[0]?.backup;
  }

  private async list(clauses: readonly string[], fileFields: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.api.json(driveFileListSchema, {
        query: {
          fields: `nextPageToken,files(${fileFields})`,
          includeItemsFromAllDrives: true,
          pageSize: 100,
          pageToken,
          q: clauses.join(' and '),
          supportsAllDrives: true,
        },
        url: `${DRIVE_API_URL}/files`,
      });

      files.push(...result.files);

      if (result.nextPageToken === undefined) {
        return files;
      }

      pageToken = result.nextPageToken;
    }

    throw new IntegrationError(
      'INTEGRATION_UNCLASSIFIED',
      `A Drive listing returned more than ${MAX_LIST_PAGES} pages`,
    );
  }

  /** Drive's size and checksums, asked again while Drive has not computed them yet. */
  private async readChecksums(fileId: string): Promise<DriveFile> {
    for (let read = 1; ; read += 1) {
      const file = await this.api.json(driveFileSchema, {
        query: { fields: CHECKSUM_FIELDS, supportsAllDrives: true },
        url: `${DRIVE_API_URL}/files/${fileId}`,
      });

      if (
        file.sha256Checksum !== undefined ||
        file.md5Checksum !== undefined ||
        read >= CHECKSUM_READS
      ) {
        return file;
      }

      await this.sleep(CHECKSUM_READ_DELAY_MS);
    }
  }

  /** Marks a streamed upload as verified; an unmarked file is deleted, so it never lingers. */
  private async recordSha256(fileId: string, sha256: string): Promise<void> {
    try {
      await this.api.send({
        body: { appProperties: { [backupProperties.sha256]: sha256 } },
        // Setting the same property again changes nothing.
        idempotent: true,
        method: 'PATCH',
        query: { fields: 'id', supportsAllDrives: true },
        url: `${DRIVE_API_URL}/files/${fileId}`,
      });
    } catch (error) {
      await this.deleteUploaded(fileId);

      throw error;
    }
  }

  /** The root, or `_dev` in it; created only when `create` is set. */
  private async resolveBase(create: true): Promise<string>;
  private async resolveBase(create: boolean): Promise<string | undefined>;
  private async resolveBase(create: boolean): Promise<string | undefined> {
    if (this.baseFolderId !== undefined) {
      return this.baseFolderId;
    }

    await this.checkAccess();

    let baseId: string | undefined = this.rootFolderId;

    if (this.devFolder) {
      baseId = await this.findFolder(this.rootFolderId, DEV_FOLDER_NAME);

      if (baseId === undefined && create) {
        baseId = await this.createFolder(this.rootFolderId, DEV_FOLDER_NAME, {
          [backupProperties.devFolder]: 'true',
        });
      }
    }

    this.baseFolderId = baseId;

    return baseId;
  }

  /**
   * Uploads, then compares Drive's size and SHA-256 (or MD5, when Drive reports no SHA-256)
   * with the local digests. A mismatch, or no checksum at all, deletes the new file.
   */
  private async uploadVerified(
    metadata: DriveUploadMetadata,
    source: UploadSource,
    expected: () => Digests,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    let fileId: string;

    try {
      ({ fileId } = await this.uploader.upload(metadata, source, signal));
    } catch (error) {
      throw accessError(error, 'Cannot create a file in the year folder');
    }

    const file = await this.readChecksums(fileId);
    const problem = checksumProblem(file, expected());

    if (problem === undefined) {
      return fileId;
    }

    const deleted = await this.deleteUploaded(fileId);
    const outcome = deleted ? 'the file was deleted' : `delete file ${fileId} in Drive`;

    this.logger.warn('drive.upload.unverified', { driveFileId: fileId, problem });

    if (problem === 'no checksum') {
      throw new IntegrationError(
        'DRIVE_UNAVAILABLE',
        `Drive reported no checksum for the upload; ${outcome}`,
      );
    }

    throw new IntegrationError(
      'DRIVE_CHECKSUM_MISMATCH',
      `Drive's ${problem} did not match the upload; ${outcome}`,
    );
  }
}

function zipMetadata(
  name: string,
  yearFolderId: string,
  appProperties: Record<string, string>,
): DriveUploadMetadata {
  return { appProperties, mimeType: ZIP_MIME_TYPE, name, parents: [yearFolderId] };
}

function hasProperty(key: string, value: string): string {
  return `appProperties has { key=${driveQueryString(key)} and value=${driveQueryString(value)} }`;
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

function checksumProblem(
  file: DriveFile,
  expected: Digests,
): 'MD5' | 'no checksum' | 'SHA-256' | 'size' | undefined {
  if (file.size !== undefined && file.size !== expected.sizeBytes) {
    return 'size';
  }

  if (file.sha256Checksum !== undefined) {
    return file.sha256Checksum === expected.sha256 ? undefined : 'SHA-256';
  }

  if (file.md5Checksum !== undefined) {
    return file.md5Checksum === expected.md5 ? undefined : 'MD5';
  }

  return 'no checksum';
}

function inaccessible(detail: string): IntegrationError {
  return new IntegrationError('DRIVE_ROOT_INACCESSIBLE', detail);
}

/** A refused folder → `DRIVE_ROOT_INACCESSIBLE`; anything else is rethrown as it is. */
function accessError(error: unknown, detail: string): unknown {
  if (
    error instanceof GoogleApiError &&
    error.code === 'INTEGRATION_UNCLASSIFIED' &&
    (error.status === 404 ||
      (error.status === 403 && error.reason !== undefined && accessDeniedReasons.has(error.reason)))
  ) {
    return inaccessible(
      `${detail} (HTTP ${error.status}${error.reason === undefined ? '' : `, ${error.reason}`})`,
    );
  }

  return error;
}

function errorCode(error: unknown): string {
  return error instanceof IntegrationError ? error.code : 'UNKNOWN_ERROR';
}
