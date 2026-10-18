import type { IdGenerator } from '../../shared/ids.js';
import { randomIds } from '../../shared/ids.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { GoogleApiError } from '../google/google-api-client.js';
import type { DriveFile } from './drive-schemas.js';
import {
  DRIVE_API_URL,
  DRIVE_FOLDER_MIME_TYPE,
  driveFileListSchema,
  driveFileSchema,
  driveIdSchema,
} from './drive-schemas.js';

export type DriveCheckId = 'C1' | 'C2' | 'C3' | 'C4';

export interface DriveCheck {
  /** Names, counts and HTTP statuses only. */
  readonly detail: string;
  readonly id: DriveCheckId;
  readonly outcome: 'fail' | 'pass' | 'skip';
}

export interface DriveAccessReport {
  readonly checks: readonly DriveCheck[];
  /** Probe files that could not be deleted; the user removes them in Drive. */
  readonly leftoverProbeIds: readonly string[];
  /** The visible year folder, when C2 found exactly one. */
  readonly yearFolderId: string | undefined;
}

export interface DriveAccessCheckOptions {
  api: GoogleApiClient;
  ids?: IdGenerator;
  rootFolderId: string;
  /** The year folder name, such as `2026`. */
  year: string;
}

/** Marks app-created probe files, so a leftover one is easy to recognise. */
export const PROBE_APP_PROPERTY = 'notionBackupProbe';
/** Marks the app-owned root that `drive:init` creates (S6 fallback 2). */
export const ROOT_APP_PROPERTY = 'notionBackupRoot';
export const APP_OWNED_ROOT_NAME = 'Full Workspace';

/**
 * S6: can `drive.file` use the configured backup root and its year folder?
 * - C1: the root is visible;
 * - C2: exactly one year folder is visible in it;
 * - C3: a file can be created in the root, and deleted again;
 * - C4: a file can be created in the year folder, and deleted again.
 *
 * Every check runs, so one report shows the whole picture. Auth and availability failures
 * abort the check, since no verdict can be drawn from them.
 */
export async function checkDriveAccess({
  api,
  ids = randomIds,
  rootFolderId,
  year,
}: DriveAccessCheckOptions): Promise<DriveAccessReport> {
  const rootId = driveIdSchema.parse(rootFolderId);

  if (!/^\d{4}$/.test(year)) {
    throw new Error('The year folder name must be four digits');
  }

  const leftoverProbeIds: string[] = [];

  const probe = async (id: DriveCheckId, parentId: string, where: string): Promise<DriveCheck> => {
    const result = await probeWrite(api, parentId, `.nba-access-probe-${ids.shortId()}`);

    if (result.leftoverId !== undefined) {
      leftoverProbeIds.push(result.leftoverId);
    }

    return { detail: `${where}: ${result.detail}`, id, outcome: result.ok ? 'pass' : 'fail' };
  };

  const c1 = await checkDriveRoot(api, rootId);
  const { check: c2, folderId: yearFolderId } = await checkYearFolder(api, rootId, year);
  const c3 = await probe('C3', rootId, 'root');
  const c4: DriveCheck =
    yearFolderId === undefined
      ? { detail: `skipped: no single ${year} folder is visible`, id: 'C4', outcome: 'skip' }
      : await probe('C4', yearFolderId, `${year} folder`);

  return { checks: [c1, c2, c3, c4], leftoverProbeIds, yearFolderId };
}

/** C1 alone: read-only, so `doctor` runs it too. */
export async function checkDriveRoot(api: GoogleApiClient, rootId: string): Promise<DriveCheck> {
  let root: DriveFile;

  try {
    root = await api.json(driveFileSchema, {
      query: {
        fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)',
        supportsAllDrives: true,
      },
      url: `${DRIVE_API_URL}/files/${rootId}`,
    });
  } catch (error) {
    return { detail: `root not visible: ${refusal(error)}`, id: 'C1', outcome: 'fail' };
  }

  if (root.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    return { detail: 'the root is not a folder', id: 'C1', outcome: 'fail' };
  }

  if (root.trashed === true) {
    return { detail: 'the root is in the trash', id: 'C1', outcome: 'fail' };
  }

  const canAdd = root.capabilities?.canAddChildren === true ? 'yes' : 'no';
  // JSON quoting escapes C0 controls; escape C1, bidi controls and Unicode line separators too.
  const name = JSON.stringify(root.name ?? '').replaceAll(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => String.raw`\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`,
  );

  return {
    detail: `root visible: ${name}, canAddChildren ${canAdd}`,
    id: 'C1',
    outcome: 'pass',
  };
}

async function checkYearFolder(
  api: GoogleApiClient,
  rootId: string,
  year: string,
): Promise<{ check: DriveCheck; folderId: string | undefined }> {
  const folders: DriveFile[] = [];

  try {
    let pageToken: string | undefined;

    do {
      const page = await api.json(driveFileListSchema, {
        query: {
          fields: 'nextPageToken,files(id,name)',
          includeItemsFromAllDrives: true,
          pageSize: 100,
          pageToken,
          q: `'${rootId}' in parents and trashed = false and mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
          supportsAllDrives: true,
        },
        url: `${DRIVE_API_URL}/files`,
      });

      folders.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
  } catch (error) {
    return {
      check: { detail: `cannot list the root: ${refusal(error)}`, id: 'C2', outcome: 'fail' },
      folderId: undefined,
    };
  }

  const matches = folders.filter((folder) => folder.name === year);
  const visible = `${folders.length} visible subfolder${folders.length === 1 ? '' : 's'}`;

  if (matches.length === 1 && matches[0] !== undefined) {
    return {
      check: { detail: `${year} folder visible (${visible})`, id: 'C2', outcome: 'pass' },
      folderId: matches[0].id,
    };
  }

  const detail =
    matches.length === 0
      ? `no ${year} folder visible (${visible})`
      : `${matches.length} folders named ${year}; only one may exist`;

  return { check: { detail, id: 'C2', outcome: 'fail' }, folderId: undefined };
}

interface ProbeResult {
  detail: string;
  leftoverId: string | undefined;
  ok: boolean;
}

/** Creates an empty, marked probe file under `parentId`, then deletes it. */
async function probeWrite(
  api: GoogleApiClient,
  parentId: string,
  name: string,
): Promise<ProbeResult> {
  let probeId: string;

  try {
    ({ id: probeId } = await api.json(driveFileSchema, {
      body: {
        appProperties: { [PROBE_APP_PROPERTY]: 'true' },
        mimeType: 'text/plain',
        name,
        parents: [parentId],
      },
      method: 'POST',
      query: { fields: 'id', supportsAllDrives: true },
      url: `${DRIVE_API_URL}/files`,
    }));
  } catch (error) {
    return { detail: `cannot create a file: ${refusal(error)}`, leftoverId: undefined, ok: false };
  }

  try {
    await api.send({
      method: 'DELETE',
      query: { supportsAllDrives: true },
      url: `${DRIVE_API_URL}/files/${probeId}`,
    });
  } catch (error) {
    // A lost DELETE response can lead to a retry returning 404: the probe is already gone.
    if (!(error instanceof GoogleApiError) || error.status !== 404) {
      return {
        detail: `created a probe file but cannot delete it: ${refusal(error)}`,
        leftoverId: probeId,
        ok: false,
      };
    }
  }

  return { detail: 'created and deleted a probe file', leftoverId: undefined, ok: true };
}

/**
 * "HTTP 404 (notFound)" for a refused request. Auth and availability errors are rethrown:
 * they say nothing about folder access.
 */
function refusal(error: unknown): string {
  if (error instanceof GoogleApiError && error.code === 'INTEGRATION_UNCLASSIFIED') {
    const reason = error.reason === undefined ? '' : ` (${error.reason})`;

    return error.status === undefined ? error.message : `HTTP ${error.status}${reason}`;
  }

  throw error;
}

export interface AppOwnedRoot {
  readonly created: boolean;
  readonly folderId: string;
}

/**
 * S6 fallback 2 (`drive:init`): the app-owned `Full Workspace` folder at the top of My Drive,
 * created once. Running it again returns the same folder.
 */
export async function ensureAppOwnedRoot(api: GoogleApiClient): Promise<AppOwnedRoot> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const page = await api.json(driveFileListSchema, {
      query: {
        fields: 'nextPageToken,files(id,name)',
        pageSize: 10,
        pageToken,
        q: `appProperties has { key='${ROOT_APP_PROPERTY}' and value='true' } and trashed = false and mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
      },
      url: `${DRIVE_API_URL}/files`,
    });

    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);

  if (files.length > 1) {
    throw new Error(
      `Found ${files.length} app-owned root folders; keep one and delete the others in Drive`,
    );
  }

  if (files[0] !== undefined) {
    return { created: false, folderId: files[0].id };
  }

  const folder = await api.json(driveFileSchema, {
    body: {
      appProperties: { [ROOT_APP_PROPERTY]: 'true' },
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      name: APP_OWNED_ROOT_NAME,
    },
    method: 'POST',
    query: { fields: 'id' },
    url: `${DRIVE_API_URL}/files`,
  });

  return { created: true, folderId: folder.id };
}
