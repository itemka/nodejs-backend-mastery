import { DEV_FOLDER_NAME, yearFolderName } from '../../domain/naming.js';
import type { Period } from '../../domain/period.js';
import type { Logger } from '../../shared/logger.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { ROOT_APP_PROPERTY } from './drive-access-check.js';
import { accessError, backupProperties, inaccessible, listDriveFiles } from './drive-common.js';
import type { DriveFile } from './drive-schemas.js';
import {
  DRIVE_API_URL,
  DRIVE_FOLDER_MIME_TYPE,
  driveFileSchema,
  driveIdSchema,
  driveQueryString,
} from './drive-schemas.js';

const YEAR_FOLDER_PATTERN = /^\d{4}$/;

export interface DriveFoldersOptions {
  readonly api: GoogleApiClient;
  /** `APP_ENV=dev`: every folder and file goes under the app-created `_dev` folder. */
  readonly devFolder: boolean;
  readonly logger: Logger;
  readonly rootFolderId: string;
}

/** The folder that holds the year folders: the root, or `_dev` in it. */
interface BaseFolder {
  /** Created by the app (`_dev`, the `drive:init` root), so every folder in it is visible. */
  readonly appCreated: boolean;
  readonly id: string;
}

/**
 * The backup root and its year folders. Year folders are found by exact name under the root
 * (the S6 "existing" mode finds your picked `2026` folder), or created with
 * `appProperties.notionBackupYear` (later years, the app-owned root, `_dev`). `drive.file` hides
 * a folder whose grant is lost, so a hidden folder looks missing. The root must therefore be
 * visible first, and in your own root the app creates only years after every year folder it can
 * see. Otherwise a second `2026` folder would appear next to yours.
 */
export class DriveFolders {
  /** Once resolved. */
  private base: BaseFolder | undefined;
  private readonly rootFolderId: string;

  constructor(private readonly options: DriveFoldersOptions) {
    this.rootFolderId = driveIdSchema.parse(options.rootFolderId);
  }

  /** The root, checked: a visible, writable folder that is not in the trash. */
  async readRoot(signal: AbortSignal | undefined): Promise<DriveFile> {
    let root: DriveFile;

    try {
      root = await this.options.api.json(driveFileSchema, {
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

  /** The period's year folder, created when missing (and, in your root, allowed). */
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

  /** The period's year folder; undefined while it, or `_dev`, does not exist. */
  async findYearFolder(period: Period, signal?: AbortSignal): Promise<string | undefined> {
    const base = await this.resolveBase(false, signal);

    return base === undefined
      ? undefined
      : this.findFolder(base.id, yearFolderName(period), signal);
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
    const folders = await listDriveFiles(
      this.options.api,
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
      const folder = await this.options.api.json(driveFileSchema, {
        body: { appProperties, mimeType: DRIVE_FOLDER_MIME_TYPE, name, parents: [parentId] },
        method: 'POST',
        query: { fields: 'id', supportsAllDrives: true },
        signal,
        url: `${DRIVE_API_URL}/files`,
      });

      this.options.logger.info('drive.folder.created', { folderId: folder.id, name });

      return folder.id;
    } catch (error) {
      throw accessError(error, `Cannot create the ${name} folder`);
    }
  }

  private async findFolder(
    parentId: string,
    name: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    const listed = await listDriveFiles(
      this.options.api,
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

    if (!this.options.devFolder) {
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
}
