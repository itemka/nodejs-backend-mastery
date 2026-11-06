import { IntegrationError } from '../../application/integration-error.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { GoogleApiError } from '../google/google-api-client.js';
import type { DriveFile } from './drive-schemas.js';
import { DRIVE_API_URL, driveFileListSchema, driveQueryString } from './drive-schemas.js';

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

const MAX_LIST_PAGES = 10;

/**
 * Drive refuses a folder the app cannot see or write with these: 404, or 403 for a missing
 * `drive.file` grant or permission. Other 403s, such as a full Drive, stay unclassified.
 */
const accessDeniedReasons = new Set(['appNotAuthorizedToFile', 'insufficientFilePermissions']);

/** Every file matching all `clauses`, with `fileFields`, across at most ten pages. */
export async function listDriveFiles(
  api: GoogleApiClient,
  clauses: readonly string[],
  fileFields: string,
  signal?: AbortSignal,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await api.json(driveFileListSchema, {
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

/** A `q` clause: the file has this private `appProperties` entry. */
export function hasProperty(key: string, value: string): string {
  return `appProperties has { key=${driveQueryString(key)} and value=${driveQueryString(value)} }`;
}

export function inaccessible(detail: string): IntegrationError {
  return new IntegrationError('DRIVE_ROOT_INACCESSIBLE', detail);
}

/** A refused folder → `DRIVE_ROOT_INACCESSIBLE`; anything else is rethrown as it is. */
export function accessError(error: unknown, detail: string): unknown {
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

/** The cataloged code for a log line. */
export function errorCode(error: unknown): string {
  return error instanceof IntegrationError ? error.code : 'UNKNOWN_ERROR';
}
