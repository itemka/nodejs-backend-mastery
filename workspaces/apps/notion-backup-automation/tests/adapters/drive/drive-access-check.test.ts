import { describe, expect, it } from 'vitest';

import {
  checkDriveAccess,
  ensureAppOwnedRoot,
} from '../../../src/adapters/drive/drive-access-check.js';
import { GoogleApiClient } from '../../../src/adapters/google/google-api-client.js';
import { FakeGoogle, googleError } from '../../support/fake-google.js';

const FILES = 'www.googleapis.com/drive/v3/files';
const ROOT_ID = 'root-folder-id';
const FOLDER = 'application/vnd.google-apps.folder';

interface FakeDriveOptions {
  /** Parents in which the app may create files. */
  creatableIn?: readonly string[];
  deleteFails?: boolean;
  /** What `files.get` of the root returns. */
  root?: 'missing' | 'not-a-folder' | 'trashed' | 'visible';
  /** Names of the subfolders the app can see in the root. */
  subfolders?: readonly string[];
}

function fakeDrive({
  creatableIn = [],
  deleteFails = false,
  root = 'visible',
  subfolders = [],
}: FakeDriveOptions) {
  let created = 0;
  const google = new FakeGoogle()
    .on('GET', `${FILES}/${ROOT_ID}`, () => {
      if (root === 'missing') {
        return googleError(404, 'notFound');
      }

      return Response.json({
        capabilities: { canAddChildren: true },
        id: ROOT_ID,
        mimeType: root === 'not-a-folder' ? 'application/zip' : FOLDER,
        name: 'Full Workspace',
        trashed: root === 'trashed',
      });
    })
    .on('GET', FILES, () =>
      Response.json({
        files: subfolders.map((name, index) => ({ id: `folder-${index}`, name })),
      }),
    )
    .on('POST', FILES, ({ body }) => {
      const { parents = [] } = JSON.parse(body) as { parents?: string[] };

      if (!parents.every((parent) => creatableIn.includes(parent))) {
        return googleError(404, 'notFound');
      }

      created += 1;

      return Response.json({ id: `probe-${created}` });
    })
    .on('DELETE', `${FILES}/*`, () =>
      deleteFails
        ? googleError(403, 'insufficientFilePermissions')
        : new Response(null, { status: 204 }),
    );
  const api = new GoogleApiClient({
    fetch: google.fetch,
    service: 'drive',
    sleep: () => Promise.resolve(),
    tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
  });

  return { api, google };
}

const ids = { shortId: () => 'probe0001', token: () => 'unused-token-value' };

function run(api: GoogleApiClient, year = '2026') {
  return checkDriveAccess({ api, ids, rootFolderId: ROOT_ID, year });
}

describe('checkDriveAccess', () => {
  it('passes C1–C4 when the root and the year folder are usable', async () => {
    const { api, google } = fakeDrive({
      creatableIn: [ROOT_ID, 'folder-1'],
      subfolders: ['2025', '2026'],
    });

    const report = await run(api);

    expect(report.checks).toEqual([
      { detail: 'root visible: "Full Workspace", canAddChildren yes', id: 'C1', outcome: 'pass' },
      { detail: '2026 folder visible (2 visible subfolders)', id: 'C2', outcome: 'pass' },
      { detail: 'root: created and deleted a probe file', id: 'C3', outcome: 'pass' },
      { detail: '2026 folder: created and deleted a probe file', id: 'C4', outcome: 'pass' },
    ]);
    expect(report).toMatchObject({ leftoverProbeIds: [], yearFolderId: 'folder-1' });

    const creates = google.requests.filter((request) => request.method === 'POST');
    const deletes = google.requests.filter((request) => request.method === 'DELETE');

    expect(creates.map((request) => JSON.parse(request.body) as unknown)).toEqual([
      {
        appProperties: { notionBackupProbe: 'true' },
        mimeType: 'text/plain',
        name: '.nba-access-probe-probe0001',
        parents: [ROOT_ID],
      },
      {
        appProperties: { notionBackupProbe: 'true' },
        mimeType: 'text/plain',
        name: '.nba-access-probe-probe0001',
        parents: ['folder-1'],
      },
    ]);
    expect(deletes.map((request) => request.url.pathname)).toEqual([
      '/drive/v3/files/probe-1',
      '/drive/v3/files/probe-2',
    ]);
  });

  it('lists only folders in the root that are not trashed', async () => {
    const { api, google } = fakeDrive({});

    await run(api);

    const list = google.requests.find(
      (request) => request.method === 'GET' && request.url.pathname === '/drive/v3/files',
    );

    expect(list?.url.searchParams.get('q')).toBe(
      `'${ROOT_ID}' in parents and trashed = false and mimeType = '${FOLDER}'`,
    );
  });

  it('fails C1–C3 and skips C4 when drive.file cannot see the folders you created', async () => {
    const { api } = fakeDrive({ root: 'missing' });

    const report = await run(api);

    expect(report.checks).toEqual([
      { detail: 'root not visible: HTTP 404 (notFound)', id: 'C1', outcome: 'fail' },
      { detail: 'no 2026 folder visible (0 visible subfolders)', id: 'C2', outcome: 'fail' },
      { detail: 'root: cannot create a file: HTTP 404 (notFound)', id: 'C3', outcome: 'fail' },
      { detail: 'skipped: no single 2026 folder is visible', id: 'C4', outcome: 'skip' },
    ]);
  });

  it('passes C1 and C3 only when the root works but the year folder is not visible', async () => {
    const { api } = fakeDrive({ creatableIn: [ROOT_ID], subfolders: ['2025'] });

    const { checks } = await run(api);

    expect(checks.map(({ id, outcome }) => `${id}:${outcome}`)).toEqual([
      'C1:pass',
      'C2:fail',
      'C3:pass',
      'C4:skip',
    ]);
  });

  it('fails C2 when two year folders exist', async () => {
    const { api } = fakeDrive({ creatableIn: [ROOT_ID], subfolders: ['2026', '2026'] });

    const report = await run(api);

    expect(report.checks[1]).toEqual({
      detail: '2 folders named 2026; only one may exist',
      id: 'C2',
      outcome: 'fail',
    });
    expect(report.yearFolderId).toBeUndefined();
  });

  it.each([
    ['not-a-folder', 'the root is not a folder'],
    ['trashed', 'the root is in the trash'],
  ] as const)('fails C1 when the root is %s', async (root, detail) => {
    const { api } = fakeDrive({ root });

    const report = await run(api);

    expect(report.checks[0]).toEqual({ detail, id: 'C1', outcome: 'fail' });
  });

  it('fails the write check and reports a probe it could not delete', async () => {
    const { api } = fakeDrive({ creatableIn: [ROOT_ID], deleteFails: true });

    const report = await run(api);

    expect(report.checks[2]).toEqual({
      detail:
        'root: created a probe file but cannot delete it: HTTP 403 (insufficientFilePermissions)',
      id: 'C3',
      outcome: 'fail',
    });
    expect(report.leftoverProbeIds).toEqual(['probe-1']);
  });

  it('aborts on an auth failure instead of reporting a verdict', async () => {
    const { api, google } = fakeDrive({});

    google.on('GET', `${FILES}/${ROOT_ID}`, () => googleError(401));

    await expect(run(api)).rejects.toMatchObject({ code: 'GOOGLE_AUTH_REQUIRED' });
  });

  it('rejects a year that is not four digits', async () => {
    const { api, google } = fakeDrive({});

    await expect(run(api, "2026' or name != '")).rejects.toThrow('four digits');
    expect(google.requests).toEqual([]);
  });
});

/** A Drive in which the app already created the given root folders. */
function driveWithRoots(existing: readonly string[]) {
  const google = new FakeGoogle()
    .on('GET', FILES, () =>
      Response.json({ files: existing.map((id) => ({ id, name: 'Full Workspace' })) }),
    )
    .on('POST', FILES, () => Response.json({ id: 'new-root-id' }));
  const api = new GoogleApiClient({
    fetch: google.fetch,
    service: 'drive',
    sleep: () => Promise.resolve(),
    tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
  });

  return { api, google };
}

describe('ensureAppOwnedRoot', () => {
  it('creates the marked root folder at the top of My Drive', async () => {
    const { api, google } = driveWithRoots([]);

    await expect(ensureAppOwnedRoot(api)).resolves.toEqual({
      created: true,
      folderId: 'new-root-id',
    });

    const [list, create] = google.requests;

    expect(list?.url.searchParams.get('q')).toContain(
      "appProperties has { key='notionBackupRoot' and value='true' }",
    );
    expect(JSON.parse(create?.body ?? '{}')).toEqual({
      appProperties: { notionBackupRoot: 'true' },
      mimeType: FOLDER,
      name: 'Full Workspace',
    });
  });

  it('returns the existing root instead of creating a second one', async () => {
    const { api, google } = driveWithRoots(['existing-root-id']);

    await expect(ensureAppOwnedRoot(api)).resolves.toEqual({
      created: false,
      folderId: 'existing-root-id',
    });
    expect(google.requests.filter((request) => request.method === 'POST')).toEqual([]);
  });

  it('refuses to choose between several app-owned roots', async () => {
    const { api } = driveWithRoots(['root-a', 'root-b']);

    await expect(ensureAppOwnedRoot(api)).rejects.toThrow('Found 2 app-owned root folders');
  });
});
