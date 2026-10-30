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
import type { Sleep } from '../../shared/sleep.js';
import { pause, systemSleep } from '../../shared/sleep.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { GoogleApiError } from '../google/google-api-client.js';
import { ROOT_APP_PROPERTY } from './drive-access-check.js';
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
import { bytesSource, openFileSource } from './resumable-upload.js';

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

const BACKUP_FIELDS = 'id,name,size,sha256Checksum,appProperties,createdTime';
const YEAR_FOLDER_PATTERN = /^\d{4}$/;
const CHECKSUM_FIELDS = 'id,size,sha256Checksum';
const MAX_LIST_PAGES = 10;
/**
 * Drive may report the SHA-256 a moment after the upload: it is asked again after each of these
 * waits. Upload and discovery check the same SHA-256, so a stored backup can always be found.
 */
const CHECKSUM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

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
  sleep?: Sleep;
  uploader: ResumableUploader;
  /** `WRITE_SHA256_SIDECAR`: write `<name>.zip.sha256` next to each ZIP. */
  writeSidecar: boolean;
}

/** The folder that holds the year folders: the root, or `_dev` in it. */
interface BaseFolder {
  /** Created by the app (`_dev`, the `drive:init` root), so every folder in it is visible. */
  readonly appCreated: boolean;
  readonly id: string;
}

/**
 * `BackupStorage` on Drive REST v3 with `drive.file`. Year folders are found by exact name
 * under the root (the S6 "existing" mode finds your picked `2026` folder), or created with
 * `appProperties.notionBackupYear` (later years, the app-owned root, `_dev`). `drive.file` hides
 * a folder whose grant is lost, so a hidden folder looks missing. The root must therefore be
 * visible first, and in your own root the app creates only years after every year folder it can
 * see. Otherwise a second `2026` folder would appear next to yours.
 */
export class DriveBackupStorage implements BackupStorage {
  private readonly api: GoogleApiClient;
  /** Once resolved. */
  private base: BaseFolder | undefined;
  private readonly devFolder: boolean;
  private readonly logger: Logger;
  private readonly rootFolderId: string;
  private readonly sleep: Sleep;
  private readonly uploader: ResumableUploader;
  private readonly writeSidecar: boolean;

  constructor({
    api,
    devFolder,
    logger,
    rootFolderId,
    sleep = systemSleep,
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

  async checkAccess(signal?: AbortSignal): Promise<void> {
    await this.readRoot(signal);
  }

  /** The S6 outcome: `app-owned` when `drive:init` created the root, else `existing`. */
  async rootMode(signal?: AbortSignal): Promise<'app-owned' | 'existing'> {
    const root = await this.readRoot(signal);

    return root.appProperties?.[ROOT_APP_PROPERTY] === 'true' ? 'app-owned' : 'existing';
  }

  async ensureYearFolder(period: Period, signal?: AbortSignal): Promise<string> {
    const base = await this.resolveBase(true, signal);
    const year = yearFolderName(period);
    const existing = await this.findFolder(base.id, year, signal);

    if (existing !== undefined) {
      return existing;
    }

    if (!base.appCreated) {
      await this.assertNewYear(base.id, year, signal);
    }

    return this.createFolder(base.id, year, { [backupProperties.year]: year }, signal);
  }

  async findExisting(query: BackupQuery, signal?: AbortSignal): Promise<StoredBackup | undefined> {
    const base = await this.resolveBase(false, signal);

    if (base === undefined) {
      return undefined;
    }

    const yearFolderId = await this.findFolder(base.id, yearFolderName(query.period), signal);

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
      fileId = await this.uploadVerified(
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

  /**
   * In your root, a missing year folder may be one whose grant is lost, so the app creates only
   * years after every year folder it can see. Your picked `2026` must stay visible; `2027` and
   * later are the app's own.
   */
  private async assertNewYear(
    baseId: string,
    year: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const folders = await this.list(
      [
        `${driveQueryString(baseId)} in parents`,
        'trashed = false',
        `mimeType = ${driveQueryString(DRIVE_FOLDER_MIME_TYPE)}`,
      ],
      'id,name',
      signal,
    );
    const years = folders
      .map((folder) => folder.name ?? '')
      .filter((name) => YEAR_FOLDER_PATTERN.test(name))
      .map(Number);

    if (years.length === 0) {
      throw inaccessible(`No year folder is visible in the backup root, so ${year} is not created`);
    }

    const newest = Math.max(...years);

    if (Number(year) <= newest) {
      throw inaccessible(
        `The ${year} folder is not visible; the app creates only years after ${newest}`,
      );
    }
  }

  private async createFolder(
    parentId: string,
    name: string,
    appProperties: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    try {
      const folder = await this.api.json(driveFileSchema, {
        body: { appProperties, mimeType: DRIVE_FOLDER_MIME_TYPE, name, parents: [parentId] },
        method: 'POST',
        query: { fields: 'id', supportsAllDrives: true },
        signal,
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

    const name = sha256SidecarName(backup.fileName);

    try {
      // Name and digest together: two ZIPs with the same bytes but different names each get one.
      const existing = await this.list(
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

      await this.uploadVerified(
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

      this.logger.warn('drive.sidecar.failed', {
        code: errorCode(error),
        driveFileId: backup.driveFileId,
      });

      return 'failed';
    }
  }

  private async findFolder(
    parentId: string,
    name: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    const listed = await this.list(
      [
        `${driveQueryString(parentId)} in parents`,
        'trashed = false',
        `mimeType = ${driveQueryString(DRIVE_FOLDER_MIME_TYPE)}`,
        `name = ${driveQueryString(name)}`,
      ],
      'id,name',
      signal,
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
    signal?: AbortSignal,
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
        this.logger.warn('drive.backup.unverified', { driveFileId: file.id });
        continue;
      }

      verified.push({ backup, createdMs: Date.parse(file.createdTime ?? '') || 0 });
    }

    return verified.toSorted((a, b) => b.createdMs - a.createdMs)[0]?.backup;
  }

  private async list(
    clauses: readonly string[],
    fileFields: string,
    signal?: AbortSignal,
  ): Promise<DriveFile[]> {
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
        signal,
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

  /** Drive's size and SHA-256, asked again while Drive has not computed the SHA-256 yet. */
  private async readChecksum(fileId: string, signal: AbortSignal | undefined): Promise<DriveFile> {
    const read = () =>
      this.api.json(driveFileSchema, {
        query: { fields: CHECKSUM_FIELDS, supportsAllDrives: true },
        signal,
        url: `${DRIVE_API_URL}/files/${fileId}`,
      });
    let file = await read();

    for (const delayMs of CHECKSUM_RETRY_DELAYS_MS) {
      if (file.sha256Checksum !== undefined) {
        break;
      }

      await pause(this.sleep, delayMs, signal);
      file = await read();
    }

    return file;
  }

  /** The root, checked: a visible, writable folder that is not in the trash. */
  private async readRoot(signal: AbortSignal | undefined): Promise<DriveFile> {
    let root: DriveFile;

    try {
      root = await this.api.json(driveFileSchema, {
        query: {
          fields: 'id,mimeType,trashed,capabilities(canAddChildren),appProperties',
          supportsAllDrives: true,
        },
        signal,
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

    return root;
  }

  /** The root, or `_dev` in it; created only when `create` is set. */
  private async resolveBase(create: true, signal: AbortSignal | undefined): Promise<BaseFolder>;
  private async resolveBase(
    create: boolean,
    signal: AbortSignal | undefined,
  ): Promise<BaseFolder | undefined>;
  private async resolveBase(
    create: boolean,
    signal: AbortSignal | undefined,
  ): Promise<BaseFolder | undefined> {
    if (this.base !== undefined) {
      return this.base;
    }

    const root = await this.readRoot(signal);

    if (!this.devFolder) {
      this.base = {
        appCreated: root.appProperties?.[ROOT_APP_PROPERTY] === 'true',
        id: this.rootFolderId,
      };

      return this.base;
    }

    // Only the app makes `_dev`.
    const devId =
      (await this.findFolder(this.rootFolderId, DEV_FOLDER_NAME, signal)) ??
      (create
        ? await this.createFolder(
            this.rootFolderId,
            DEV_FOLDER_NAME,
            { [backupProperties.devFolder]: 'true' },
            signal,
          )
        : undefined);

    this.base = devId === undefined ? undefined : { appCreated: true, id: devId };

    return this.base;
  }

  /**
   * Uploads, then compares Drive's size and SHA-256 with the local digests. Unless they match,
   * the new file is deleted: a mismatch, no SHA-256, or a failure to read it.
   */
  private async uploadVerified(
    metadata: DriveUploadMetadata,
    source: UploadSource,
    expected: Digests,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    let fileId: string;

    try {
      ({ fileId } = await this.uploader.upload(metadata, source, signal));
    } catch (error) {
      throw accessError(error, 'Cannot create a file in the year folder');
    }

    let file: DriveFile;

    try {
      file = await this.readChecksum(fileId, signal);
    } catch (error) {
      await this.deleteUploaded(fileId);

      throw error;
    }

    const problem = checksumProblem(file, expected);

    if (problem === undefined) {
      return fileId;
    }

    const deleted = await this.deleteUploaded(fileId);
    const outcome = deleted ? 'the file was deleted' : `delete file ${fileId} in Drive`;

    this.logger.warn('drive.upload.unverified', { driveFileId: fileId, problem });

    if (problem === 'no SHA-256') {
      throw new IntegrationError(
        'DRIVE_UNAVAILABLE',
        `Drive reported no SHA-256 for the upload; ${outcome}`,
      );
    }

    throw new IntegrationError(
      'DRIVE_CHECKSUM_MISMATCH',
      `Drive's ${problem} did not match the upload; ${outcome}`,
    );
  }

  /** A new ZIP in Drive, verified. */
  private async uploaded(
    backup: StoredBackup,
    signal: AbortSignal | undefined,
  ): Promise<UploadedBackup> {
    this.logger.info('drive.backup.uploaded', {
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
    this.logger.info('drive.backup.exists', { driveFileId: existing.driveFileId });

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

/** Discovery (`verifiedBackup`) checks the same SHA-256, so an accepted upload is always found. */
function checksumProblem(
  file: DriveFile,
  expected: Digests,
): 'no SHA-256' | 'SHA-256' | 'size' | undefined {
  if (file.size !== undefined && file.size !== expected.sizeBytes) {
    return 'size';
  }

  if (file.sha256Checksum === undefined) {
    return 'no SHA-256';
  }

  return file.sha256Checksum === expected.sha256 ? undefined : 'SHA-256';
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
    const reason = error.reason === undefined ? '' : `, ${error.reason}`;

    return inaccessible(`${detail} (HTTP ${error.status}${reason})`);
  }

  return error;
}

function errorCode(error: unknown): string {
  return error instanceof IntegrationError ? error.code : 'UNKNOWN_ERROR';
}
