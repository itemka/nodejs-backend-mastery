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

  it('escapes provider-controlled names before they reach terminal output', async () => {
    const { api, google } = fakeDrive({});
    const name = 'Backup\u001B[2J\u001B]52;c;clipboard\u0007\r\nforged\u009B31m\u202E\u2028';

    google.on('GET', `${FILES}/${ROOT_ID}`, () =>
      Response.json({ id: ROOT_ID, mimeType: FOLDER, name }),
    );

    const report = await run(api);
    const detail = report.checks[0]?.detail ?? '';

    expect(detail).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(detail).toContain(String.raw`Backup\u001b[2J`);
    expect(detail).toContain(String.raw`\r\nforged`);
    expect(detail).toContain(String.raw`\u009b31m`);
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

  it('finds the year folder on a later page, continuing past an empty page', async () => {
    const { api, google } = fakeDrive({ creatableIn: [ROOT_ID, 'year-folder'] });

    google.on('GET', FILES, ({ url }) => {
      switch (url.searchParams.get('pageToken')) {
        case null: {
          return Response.json({
            files: Array.from({ length: 100 }, (_, index) => ({
              id: `folder-${index}`,
              name: `other-${index}`,
            })),
            nextPageToken: 'second-page',
          });
        }

        case 'second-page': {
          return Response.json({ files: [], nextPageToken: 'third-page' });
        }

        case 'third-page': {
          return Response.json({ files: [{ id: 'year-folder', name: '2026' }] });
        }

        default: {
          return googleError(400);
        }
      }
    });

    const report = await run(api);

    expect(report.checks[1]).toEqual({
      detail: '2026 folder visible (101 visible subfolders)',
      id: 'C2',
      outcome: 'pass',
    });
    expect(report.yearFolderId).toBe('year-folder');
    expect(report.checks[3]?.outcome).toBe('pass');

    const pages = google
      .requestsTo(FILES)
      .filter(({ url }) => url.pathname === '/drive/v3/files' && url.searchParams.has('q'));

    expect(pages.map(({ url }) => url.searchParams.get('pageToken'))).toEqual([
      null,
      'second-page',
      'third-page',
    ]);
    expect(
      pages.every(({ url }) => url.searchParams.get('fields')?.includes('nextPageToken')),
    ).toBe(true);
  });

  it('fails C2 and skips C4 when a duplicate year folder appears on a later page', async () => {
    const { api, google } = fakeDrive({ creatableIn: [ROOT_ID, 'first-year'] });

    google.on('GET', FILES, ({ url }) =>
      Response.json(
        url.searchParams.has('pageToken')
          ? { files: [{ id: 'second-year', name: '2026' }] }
          : { files: [{ id: 'first-year', name: '2026' }], nextPageToken: 'second-page' },
      ),
    );

    const report = await run(api);

    expect(report.checks[1]).toEqual({
      detail: '2 folders named 2026; only one may exist',
      id: 'C2',
      outcome: 'fail',
    });
    expect(report.yearFolderId).toBeUndefined();
    expect(report.checks[3]?.outcome).toBe('skip');
  });

  it('propagates an outage on a later page rather than accepting an incomplete listing', async () => {
    const { api, google } = fakeDrive({});

    google.on('GET', FILES, ({ url }) =>
      url.searchParams.has('pageToken')
        ? googleError(503)
        : Response.json({
            files: [{ id: 'first-year', name: '2026' }],
            nextPageToken: 'second-page',
          }),
    );

    await expect(run(api)).rejects.toMatchObject({ code: 'DRIVE_UNAVAILABLE' });
    expect(google.requests.filter(({ method }) => method === 'POST')).toEqual([]);
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

  it('passes the write checks when a DELETE succeeds but its response is lost before a 404 retry', async () => {
    const { api, google } = fakeDrive({
      creatableIn: [ROOT_ID, 'folder-0'],
      subfolders: ['2026'],
    });
    const deleted = new Set<string>();

    google.on('DELETE', `${FILES}/*`, ({ url }) => {
      if (deleted.has(url.pathname)) {
        return googleError(404, 'notFound');
      }

      deleted.add(url.pathname);

      throw new TypeError('DELETE response lost after the file was removed');
    });

    const report = await run(api);

    expect(report.checks.map(({ outcome }) => outcome)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(report.leftoverProbeIds).toEqual([]);
    expect(google.requests.filter(({ method }) => method === 'DELETE')).toHaveLength(4);
  });

  it.each([
    [401, 'GOOGLE_AUTH_REQUIRED'],
    [503, 'DRIVE_UNAVAILABLE'],
  ])('reports the leftover ID after HTTP %s during probe cleanup', async (status, code) => {
    const { api, google } = fakeDrive({ creatableIn: [ROOT_ID] });

    google.on('DELETE', `${FILES}/*`, () => googleError(status));

    const report = await run(api);

    expect(report.leftoverProbeIds).toEqual(['probe-1']);
    expect(report.checks[2]).toMatchObject({ outcome: 'fail' });
    expect(report.checks[2]?.detail).toContain(code);
  });

  it.each(['network', 'server', 'invalid-success'] as const)(
    'recovers and cleans up an ambiguous probe creation after a %s failure',
    async (failure) => {
      const { api, google } = fakeDrive({});
      let probe: unknown;

      google.on('POST', FILES, ({ body }) => {
        probe = { ...(JSON.parse(body) as Record<string, unknown>), id: 'recovered-probe' };

        if (failure === 'network') {
          throw new TypeError('response lost after creation');
        }

        return failure === 'server' ? googleError(503) : Response.json({});
      });
      google.on('GET', FILES, ({ url }) =>
        Response.json({
          files: url.searchParams.get('q')?.includes('notionBackupProbe') ? [probe] : [],
        }),
      );

      const report = await run(api);

      expect(report.checks[2]?.outcome).toBe('pass');
      expect(report.leftoverProbeIds).toEqual([]);
      expect(google.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
      expect(
        google.requests.filter(({ method }) => method === 'DELETE').map(({ url }) => url.pathname),
      ).toEqual(['/drive/v3/files/recovered-probe']);
    },
  );

  it('reports an ambiguous probe ID and stops further write probes if recovered cleanup fails', async () => {
    const { api, google } = fakeDrive({});
    let probe: unknown;

    google.on('POST', FILES, ({ body }) => {
      probe = { ...(JSON.parse(body) as Record<string, unknown>), id: 'recovered-probe' };

      throw new TypeError('response lost');
    });
    google.on('GET', FILES, ({ url }) =>
      Response.json({
        files: url.searchParams.get('q')?.includes('notionBackupProbe')
          ? [probe]
          : [{ id: 'year-folder', name: '2026' }],
      }),
    );
    google.on('DELETE', `${FILES}/*`, () => googleError(503));

    const report = await run(api);

    expect(report.leftoverProbeIds).toEqual(['recovered-probe']);
    expect(report.checks[2]?.outcome).toBe('fail');
    expect(report.checks[3]?.outcome).toBe('skip');
    expect(google.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it.each([
    ['name', { name: 'unrelated' }],
    ['MIME type', { mimeType: 'application/zip' }],
    ['parent', { parents: ['another-parent'] }],
    ['app marker', { appProperties: {} }],
  ])(
    'does not delete a file with mismatched %s during reconciliation',
    async (_field, mismatch) => {
      const { api, google } = fakeDrive({});
      const probe = {
        appProperties: { notionBackupProbe: 'true' },
        id: 'unrelated-file',
        mimeType: 'text/plain',
        name: '.nba-access-probe-probe0001',
        parents: [ROOT_ID],
        ...mismatch,
      };

      google.on('POST', FILES, () => {
        throw new TypeError('response lost');
      });
      google.on('GET', FILES, () => Response.json({ files: [probe] }));

      await expect(run(api)).rejects.toMatchObject({ code: 'DRIVE_UNAVAILABLE' });
      expect(google.requests.filter(({ method }) => method === 'DELETE')).toEqual([]);
      expect(google.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    },
  );

  it.each(['duplicates', 'page-limit', 'page-failure'] as const)(
    'reports known IDs without deletion when reconciliation finds %s',
    async (mode) => {
      const { api, google } = fakeDrive({});
      const probe = {
        appProperties: { notionBackupProbe: 'true' },
        id: 'recovered-a',
        mimeType: 'text/plain',
        name: '.nba-access-probe-probe0001',
        parents: [ROOT_ID],
      };

      google.on('POST', FILES, () => {
        throw new TypeError('response lost');
      });
      google.on('GET', FILES, ({ url }) => {
        if (!url.searchParams.get('q')?.includes('notionBackupProbe')) {
          return Response.json({ files: [] });
        }

        if (!url.searchParams.has('pageToken')) {
          return Response.json({ files: [probe], nextPageToken: 'next-page' });
        }

        if (mode === 'page-failure') {
          return googleError(503);
        }

        return Response.json(
          mode === 'duplicates'
            ? { files: [{ ...probe, id: 'recovered-b' }] }
            : { nextPageToken: 'next-page' },
        );
      });

      const report = await run(api);

      expect(report.leftoverProbeIds).toEqual(
        mode === 'duplicates' ? ['recovered-a', 'recovered-b'] : ['recovered-a'],
      );
      expect(report.checks[2]?.outcome).toBe('fail');
      expect(google.requests.filter(({ method }) => method === 'DELETE')).toEqual([]);
    },
  );

  it('surfaces unknown creation outcome when the recovery lookup is unavailable', async () => {
    const { api, google } = fakeDrive({});

    google.on('POST', FILES, () => {
      throw new TypeError('response lost');
    });
    google.on('GET', FILES, ({ url }) =>
      url.searchParams.get('q')?.includes('notionBackupProbe')
        ? googleError(503)
        : Response.json({ files: [] }),
    );

    await expect(run(api)).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      message: expect.stringContaining('outcome is unknown'),
    });
    expect(google.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(google.requests.filter(({ method }) => method === 'DELETE')).toEqual([]);
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

  it('finds an existing root after an empty page without creating another one', async () => {
    const { api, google } = driveWithRoots([]);

    google.on('GET', FILES, ({ url }) =>
      Response.json(
        url.searchParams.has('pageToken')
          ? { files: [{ id: 'existing-root-id', name: 'Full Workspace' }] }
          : { nextPageToken: 'second-page' },
      ),
    );

    await expect(ensureAppOwnedRoot(api)).resolves.toEqual({
      created: false,
      folderId: 'existing-root-id',
    });
    expect(google.requests.map(({ url }) => url.searchParams.get('pageToken'))).toEqual([
      null,
      'second-page',
    ]);
    expect(google.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(
      google.requests.every(({ url }) => url.searchParams.get('fields')?.includes('nextPageToken')),
    ).toBe(true);
  });

  it('refuses duplicate roots split across pages without creating another one', async () => {
    const { api, google } = driveWithRoots([]);

    google.on('GET', FILES, ({ url }) =>
      Response.json(
        url.searchParams.has('pageToken')
          ? { files: [{ id: 'root-b', name: 'Full Workspace' }] }
          : { files: [{ id: 'root-a', name: 'Full Workspace' }], nextPageToken: 'second-page' },
      ),
    );

    await expect(ensureAppOwnedRoot(api)).rejects.toThrow('Found 2 app-owned root folders');
    expect(google.requests.filter(({ method }) => method === 'POST')).toEqual([]);
  });

  it('creates a root only after the final empty page', async () => {
    const { api, google } = driveWithRoots([]);

    google.on('GET', FILES, ({ url }) =>
      Response.json(
        url.searchParams.has('pageToken')
          ? { files: [] }
          : { files: [], nextPageToken: 'second-page' },
      ),
    );

    await expect(ensureAppOwnedRoot(api)).resolves.toEqual({
      created: true,
      folderId: 'new-root-id',
    });
    expect(google.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST']);
    expect(google.requests[1]?.url.searchParams.get('pageToken')).toBe('second-page');
  });

  it('propagates a later-page outage without creating a root from an incomplete listing', async () => {
    const { api, google } = driveWithRoots([]);

    google.on('GET', FILES, ({ url }) =>
      url.searchParams.has('pageToken')
        ? googleError(503)
        : Response.json({ files: [], nextPageToken: 'second-page' }),
    );

    await expect(ensureAppOwnedRoot(api)).rejects.toMatchObject({ code: 'DRIVE_UNAVAILABLE' });
    expect(google.requests.filter(({ method }) => method === 'POST')).toEqual([]);
  });

  it('refuses to choose between several app-owned roots', async () => {
    const { api } = driveWithRoots(['root-a', 'root-b']);

    await expect(ensureAppOwnedRoot(api)).rejects.toThrow('Found 2 app-owned root folders');
  });
});
