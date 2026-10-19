import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { DriveBackupStorage } from '../../../src/adapters/drive/drive-backup-storage.js';
import {
  ResumableUploader,
  UPLOAD_CHUNK_UNIT,
} from '../../../src/adapters/drive/resumable-upload.js';
import { GoogleApiClient } from '../../../src/adapters/google/google-api-client.js';
import type { BackupUpload } from '../../../src/application/ports.js';
import { digestsOf } from '../../../src/shared/digests.js';
import { createLogger } from '../../../src/shared/logger.js';
import type { Sleep } from '../../../src/shared/sleep.js';
import type { FakeFile } from '../../support/fake-drive.js';
import { FakeDrive, FOLDER_MIME_TYPE, ROOT_ID } from '../../support/fake-drive.js';
import { googleError } from '../../support/fake-google.js';
import { tempFile } from '../../support/temp-file.js';

const FILES = 'www.googleapis.com/drive/v3/files';
const NAME = 'notion-workspace-2026-10-01.zip';
const tokenProvider = { getAccessToken: () => Promise.resolve('fake-access-token') };

function setup({
  devFolder = false,
  sleep: waitFor,
  writeSidecar = true,
}: { devFolder?: boolean; sleep?: Sleep; writeSidecar?: boolean } = {}) {
  const drive = new FakeDrive();
  const sleeps: number[] = [];

  const sleep: Sleep = (ms, signal) => {
    sleeps.push(ms);

    return waitFor === undefined ? Promise.resolve() : waitFor(ms, signal);
  };

  const logs: string[] = [];
  const storage = new DriveBackupStorage({
    api: new GoogleApiClient({ fetch: drive.fetch, service: 'drive', sleep, tokenProvider }),
    devFolder,
    logger: createLogger({
      level: 'debug',
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    rootFolderId: ROOT_ID,
    sleep,
    uploader: new ResumableUploader({
      chunkSize: UPLOAD_CHUNK_UNIT,
      fetch: drive.fetch,
      sleep,
      tokenProvider,
    }),
    writeSidecar,
  });

  return { drive, logs, sleeps, storage };
}

async function fileUpload(
  content: Uint8Array,
  overrides: Partial<Omit<BackupUpload, 'content'>> = {},
): Promise<BackupUpload> {
  const { sha256 } = digestsOf(content);

  return {
    content: { kind: 'file', path: await tempFile(content), sha256 },
    fileName: NAME,
    jobId: '2026-10',
    period: '2026-10',
    ...overrides,
  };
}

/** A ZIP the app stored before, with the properties it records. */
function addBackup(
  drive: FakeDrive,
  parentId: string,
  {
    content = randomBytes(100),
    jobId = '2026-10',
    mimeType = 'application/zip',
    name = NAME,
    period = '2026-10',
    recordedSha256,
    trashed = false,
  }: {
    content?: Uint8Array;
    jobId?: string;
    mimeType?: string;
    name?: string;
    period?: string;
    recordedSha256?: string;
    trashed?: boolean;
  } = {},
): FakeFile {
  return drive.add(
    {
      appProperties: {
        notionBackupJobId: jobId,
        notionBackupPeriod: period,
        notionBackupSha256: recordedSha256 ?? sha256Of(content),
      },
      content,
      mimeType,
      name,
      trashed,
    },
    parentId,
  );
}

/** A wait that ends only on abort: a test using it hangs unless the abort interrupts the wait. */
const untilAborted: Sleep = (_ms, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        reject(new Error('wait aborted'));
      },
      { once: true },
    );
  });

function sha256Of(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function folderCreations(drive: FakeDrive) {
  return drive.google.requestsTo(FILES).filter((request) => request.method === 'POST');
}

async function* piecesOf(content: Uint8Array, pieceSize: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < content.length; offset += pieceSize) {
    await Promise.resolve();
    yield content.slice(offset, offset + pieceSize);
  }
}

describe('DriveBackupStorage.checkAccess', () => {
  it('passes for a visible, writable folder', async () => {
    const { storage } = setup();

    await expect(storage.checkAccess()).resolves.toBeUndefined();
  });

  it.each([
    [
      'not visible',
      (drive: FakeDrive) => drive.invisible.add(ROOT_ID),
      'The backup root is not visible (HTTP 404, notFound)',
    ],
    [
      'not a folder',
      (drive: FakeDrive) => {
        const root = drive.files.get(ROOT_ID);

        if (root !== undefined) {
          root.mimeType = 'application/zip';
        }
      },
      'The backup root is not a folder',
    ],
    [
      'in the trash',
      (drive: FakeDrive) => {
        const root = drive.files.get(ROOT_ID);

        if (root !== undefined) {
          root.trashed = true;
        }
      },
      'The backup root is in the trash',
    ],
    [
      'not writable',
      (drive: FakeDrive) =>
        drive.google.on('GET', `${FILES}/${ROOT_ID}`, () =>
          Response.json({
            capabilities: { canAddChildren: false },
            id: ROOT_ID,
            mimeType: FOLDER_MIME_TYPE,
          }),
        ),
      'The backup root is not writable',
    ],
  ])('fails with DRIVE_ROOT_INACCESSIBLE when the root is %s', async (_case, arrange, message) => {
    const { drive, storage } = setup();

    arrange(drive);

    await expect(storage.checkAccess()).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
      message,
    });
  });

  it('passes an expired token on as GOOGLE_AUTH_REQUIRED', async () => {
    const { drive, storage } = setup();

    drive.google.on('GET', `${FILES}/${ROOT_ID}`, () => googleError(401));

    await expect(storage.checkAccess()).rejects.toMatchObject({ code: 'GOOGLE_AUTH_REQUIRED' });
  });
});

describe('DriveBackupStorage.ensureYearFolder', () => {
  it('reuses your existing 2026 folder by its exact name', async () => {
    const { drive, storage } = setup();
    const yours = drive.add({ name: '2026' });

    drive.add({ name: '2026 (manual)' });

    await expect(storage.ensureYearFolder('2026-10')).resolves.toBe(yours.id);
    expect(folderCreations(drive)).toEqual([]);
  });

  it('creates 2027 when it is missing, marked as the app’s, and reuses it afterwards', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });

    const created = await storage.ensureYearFolder('2027-01');

    expect(drive.files.get(created)).toMatchObject({
      appProperties: { notionBackupYear: '2027' },
      mimeType: FOLDER_MIME_TYPE,
      name: '2027',
      parents: [ROOT_ID],
    });
    await expect(storage.ensureYearFolder('2027-02')).resolves.toBe(created);
    expect(folderCreations(drive)).toHaveLength(1);
  });

  it('ignores a year folder in the trash', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2025' });
    const trashed = drive.add({ name: '2026', trashed: true });

    await expect(storage.ensureYearFolder('2026-10')).resolves.not.toBe(trashed.id);
    expect(drive.childrenOf(ROOT_ID).map((file) => file.name)).toEqual(['2025', '2026']);
  });

  it('creates no second 2026 when your 2026 folder is hidden by a lost grant', async () => {
    const { drive, storage } = setup();
    const yours = drive.add({ name: '2026' });

    drive.invisible.add(yours.id);

    await expect(storage.ensureYearFolder('2026-10')).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
      message: 'No year folder is visible in the backup root, so 2026 is not created',
    });
    expect(folderCreations(drive)).toEqual([]);
  });

  it('in your root, creates only years after the newest visible year folder', async () => {
    const { drive, storage } = setup();
    const yours = drive.add({ name: '2026' });

    drive.add({ appProperties: { notionBackupYear: '2027' }, name: '2027' });
    drive.invisible.add(yours.id);

    await expect(storage.ensureYearFolder('2026-12')).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
      message: 'The 2026 folder is not visible; the app creates only years after 2027',
    });
    expect(folderCreations(drive)).toEqual([]);

    const created = await storage.ensureYearFolder('2028-01');

    expect(drive.files.get(created)).toMatchObject({ name: '2028', parents: [ROOT_ID] });
  });

  it('in the app-owned root, creates any missing year folder', async () => {
    const { drive, storage } = setup();
    const root = drive.files.get(ROOT_ID);

    if (root !== undefined) {
      root.appProperties = { notionBackupRoot: 'true' };
    }

    const created = await storage.ensureYearFolder('2026-10');

    expect(drive.files.get(created)).toMatchObject({ name: '2026', parents: [ROOT_ID] });
  });

  it('stops resolving the year folder once the signal aborts, and creates no folder', async () => {
    const controller = new AbortController();
    const { drive, storage } = setup();

    drive.add({ name: '2026' });
    // The abort lands while Drive answers the root check.
    drive.google.on('GET', `${FILES}/${ROOT_ID}`, () => {
      controller.abort(new Error('transfer budget exceeded'));

      return Response.json({
        capabilities: { canAddChildren: true },
        id: ROOT_ID,
        mimeType: FOLDER_MIME_TYPE,
        trashed: false,
      });
    });

    await expect(storage.ensureYearFolder('2027-01', controller.signal)).rejects.toThrow(
      'transfer budget exceeded',
    );
    expect(folderCreations(drive)).toEqual([]);
  });

  it('fails with DRIVE_ROOT_INACCESSIBLE when two year folders share the name', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });
    drive.add({ name: '2026' });

    await expect(storage.ensureYearFolder('2026-10')).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
      message: '2 folders named 2026; only one may exist',
    });
  });

  it('creates nothing when the root is not visible, so no second 2026 appears next to yours', async () => {
    const { drive, storage } = setup();

    drive.invisible.add(ROOT_ID);

    await expect(storage.ensureYearFolder('2026-10')).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
    });
    expect(folderCreations(drive)).toEqual([]);
  });

  it('fails with DRIVE_ROOT_INACCESSIBLE when Drive refuses the new year folder', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });
    drive.google.on('POST', FILES, () => googleError(403, 'insufficientFilePermissions'));

    await expect(storage.ensureYearFolder('2027-01')).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
      message: 'Cannot create the 2027 folder (HTTP 403, insufficientFilePermissions)',
    });
  });

  it('with APP_ENV=dev, works under an app-created _dev folder in the root', async () => {
    const { drive, storage } = setup({ devFolder: true });

    drive.add({ name: '2026' });

    const yearId = await storage.ensureYearFolder('2026-10');
    const [dev] = drive.named('_dev');

    expect(dev).toMatchObject({ appProperties: { notionBackupDev: 'true' }, parents: [ROOT_ID] });
    expect(drive.files.get(yearId)).toMatchObject({ name: '2026', parents: [dev?.id] });
  });

  it('with APP_ENV=dev, reuses the existing _dev folder', async () => {
    const { drive, storage } = setup({ devFolder: true });
    const dev = drive.add({ name: '_dev' });
    const year = drive.add({ name: '2026' }, dev.id);

    await expect(storage.ensureYearFolder('2026-10')).resolves.toBe(year.id);
    expect(folderCreations(drive)).toEqual([]);
  });
});

describe('DriveBackupStorage.findExisting', () => {
  it('adopts the newest verified backup of the period (Redis state lost)', async () => {
    const { drive, storage } = setup();
    const year = drive.add({ name: '2026' });

    addBackup(drive, year.id, { name: 'notion-workspace-2026-10-01.zip' });

    const newest = addBackup(drive, year.id, {
      content: randomBytes(300),
      jobId: '2026-10-r2',
      name: 'notion-workspace-2026-10-05.zip',
    });

    await expect(storage.findExisting({ period: '2026-10' })).resolves.toEqual({
      driveFileId: newest.id,
      fileName: 'notion-workspace-2026-10-05.zip',
      jobId: '2026-10-r2',
      sha256: sha256Of(newest.content ?? new Uint8Array()),
      sizeBytes: 300,
      yearFolderId: year.id,
    });
  });

  it('narrows to a job and a SHA-256 when they are given', async () => {
    const { drive, storage } = setup();
    const year = drive.add({ name: '2026' });
    const first = addBackup(drive, year.id);

    addBackup(drive, year.id, { jobId: '2026-10-r2' });

    await expect(
      storage.findExisting({ jobId: '2026-10', period: '2026-10' }),
    ).resolves.toMatchObject({ driveFileId: first.id });
    await expect(
      storage.findExisting({
        period: '2026-10',
        sha256: sha256Of(first.content ?? new Uint8Array()),
      }),
    ).resolves.toMatchObject({ driveFileId: first.id });
    await expect(
      storage.findExisting({ period: '2026-10', sha256: 'a'.repeat(64) }),
    ).resolves.toBeUndefined();
  });

  it('never adopts a file whose recorded SHA-256 Drive’s checksum does not confirm', async () => {
    const { drive, logs, storage } = setup();
    const year = drive.add({ name: '2026' });
    const corrupt = addBackup(drive, year.id, { recordedSha256: 'b'.repeat(64) });

    await expect(storage.findExisting({ period: '2026-10' })).resolves.toBeUndefined();
    expect(
      logs.some((line) => line.includes('drive.backup.unverified') && line.includes(corrupt.id)),
    ).toBe(true);
  });

  it('skips trashed files, other periods, other folders and other file types', async () => {
    const { drive, storage } = setup();
    const year = drive.add({ name: '2026' });

    addBackup(drive, year.id, { trashed: true });
    addBackup(drive, year.id, { period: '2026-09' });
    addBackup(drive, year.id, { mimeType: 'text/plain' });
    addBackup(drive, ROOT_ID);

    await expect(storage.findExisting({ period: '2026-10' })).resolves.toBeUndefined();
  });

  it('creates nothing when the year folder or _dev does not exist', async () => {
    const prod = setup();

    await expect(prod.storage.findExisting({ period: '2026-10' })).resolves.toBeUndefined();
    expect(folderCreations(prod.drive)).toEqual([]);

    const dev = setup({ devFolder: true });

    await expect(dev.storage.findExisting({ period: '2026-10' })).resolves.toBeUndefined();
    expect(folderCreations(dev.drive)).toEqual([]);
  });

  it('fails with DRIVE_ROOT_INACCESSIBLE instead of reporting no backup', async () => {
    const { drive, storage } = setup();

    drive.invisible.add(ROOT_ID);

    await expect(storage.findExisting({ period: '2026-10' })).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
    });
  });
});

describe('DriveBackupStorage.upload', () => {
  it('uploads the ZIP into the year folder with its properties, then the .sha256 sidecar', async () => {
    const { drive, storage } = setup();
    const year = drive.add({ name: '2026' });
    const content = randomBytes(2 * UPLOAD_CHUNK_UNIT + 7);
    const sha256 = sha256Of(content);

    const result = await storage.upload(await fileUpload(content));

    expect(result).toEqual({
      driveFileId: expect.any(String) as string,
      fileName: NAME,
      jobId: '2026-10',
      sha256,
      sidecar: 'written',
      sizeBytes: content.length,
      uploaded: true,
      yearFolderId: year.id,
    });
    expect(drive.files.get(result.driveFileId)).toMatchObject({
      appProperties: {
        notionBackupJobId: '2026-10',
        notionBackupPeriod: '2026-10',
        notionBackupSha256: sha256,
      },
      mimeType: 'application/zip',
      name: NAME,
      parents: [year.id],
    });
    expect(Buffer.from(drive.files.get(result.driveFileId)?.content ?? []).equals(content)).toBe(
      true,
    );

    const [sidecar] = drive.named(`${NAME}.sha256`);

    expect(sidecar).toMatchObject({
      appProperties: { notionBackupSidecarOf: sha256 },
      mimeType: 'text/plain',
      parents: [year.id],
    });
    expect(Buffer.from(sidecar?.content ?? []).toString()).toBe(`${sha256}  ${NAME}\n`);
  });

  it('uploads nothing when Drive already holds a verified copy with the same SHA-256', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });

    const content = randomBytes(1000);
    const first = await storage.upload(await fileUpload(content));
    const sessions = drive.sessionCount;

    const again = await storage.upload(await fileUpload(content));

    expect(again).toEqual({ ...first, sidecar: 'exists', uploaded: false });
    expect(drive.sessionCount).toBe(sessions);
    expect(drive.named(NAME)).toHaveLength(1);
    expect(drive.named(`${NAME}.sha256`)).toHaveLength(1);
  });

  it('writes a missing sidecar when it reuses a stored ZIP', async () => {
    const { drive, storage } = setup();
    const year = drive.add({ name: '2026' });
    const content = randomBytes(1000);
    const stored = addBackup(drive, year.id, { content });

    const result = await storage.upload(await fileUpload(content));

    expect(result).toMatchObject({ driveFileId: stored.id, sidecar: 'written', uploaded: false });
    expect(drive.named(`${NAME}.sha256`)).toHaveLength(1);
  });

  it('creates the year folder of a new year', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });

    const result = await storage.upload(await fileUpload(randomBytes(10), { period: '2027-01' }));

    expect(drive.files.get(result.yearFolderId)).toMatchObject({
      appProperties: { notionBackupYear: '2027' },
      name: '2027',
    });
  });

  it('deletes the upload and throws DRIVE_CHECKSUM_MISMATCH when Drive’s SHA-256 differs', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });
    drive.checksums = () => ({ sha256Checksum: 'c'.repeat(64) });

    await expect(storage.upload(await fileUpload(randomBytes(1000)))).rejects.toMatchObject({
      code: 'DRIVE_CHECKSUM_MISMATCH',
      message: "Drive's SHA-256 did not match the upload; the file was deleted",
    });
    expect(drive.named(NAME)).toEqual([]);
    expect(drive.named(`${NAME}.sha256`)).toEqual([]);
  });

  it('asks again while Drive has no SHA-256 yet', async () => {
    const { drive, sleeps, storage } = setup({ writeSidecar: false });

    drive.add({ name: '2026' });
    drive.checksums = (file, read) =>
      read === 1 ? {} : { sha256Checksum: sha256Of(file.content ?? new Uint8Array()) };

    await expect(storage.upload(await fileUpload(randomBytes(1000)))).resolves.toMatchObject({
      uploaded: true,
    });
    expect(sleeps).toEqual([1000]);
  });

  it('deletes the upload and throws DRIVE_UNAVAILABLE when Drive never reports a SHA-256', async () => {
    const { drive, sleeps, storage } = setup();

    drive.add({ name: '2026' });
    drive.checksums = () => ({});

    await expect(storage.upload(await fileUpload(randomBytes(1000)))).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      message: 'Drive reported no SHA-256 for the upload; the file was deleted',
    });
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(drive.named(NAME)).toEqual([]);
  });

  it('stops waiting for the SHA-256 on abort, deletes the upload and writes nothing more', async () => {
    const controller = new AbortController();
    const { drive, sleeps, storage } = setup({ sleep: untilAborted });

    drive.add({ name: '2026' });

    drive.checksums = () => {
      setTimeout(() => {
        controller.abort(new Error('transfer budget exceeded'));
      }, 0);

      return {};
    };

    await expect(
      storage.upload({ ...(await fileUpload(randomBytes(1000))), signal: controller.signal }),
    ).rejects.toThrow('transfer budget exceeded');
    expect(sleeps).toEqual([1000]);
    // Cleanup does not take the aborted signal.
    expect(drive.named(NAME)).toEqual([]);
    expect(drive.named(`${NAME}.sha256`)).toEqual([]);
  });

  it('deletes the upload when its checksum cannot be read', async () => {
    const { drive, sleeps, storage } = setup();

    drive.add({ name: '2026' });

    drive.checksums = () => {
      throw new TypeError('connection reset');
    };

    await expect(storage.upload(await fileUpload(randomBytes(1000)))).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
    });
    // The Drive client's own retries of the read.
    expect(sleeps).toEqual([500, 1000]);
    expect(drive.named(NAME)).toEqual([]);
  });

  it('writes one sidecar per ZIP name, also for ZIPs with the same bytes', async () => {
    const { drive, storage } = setup();
    const content = randomBytes(1000);
    const sha256 = sha256Of(content);
    const november = 'notion-workspace-2026-11-01.zip';

    drive.add({ name: '2026' });

    await storage.upload(await fileUpload(content));
    await expect(
      storage.upload(await fileUpload(content, { fileName: november, period: '2026-11' })),
    ).resolves.toMatchObject({ sidecar: 'written', uploaded: true });

    const [sidecar] = drive.named(`${november}.sha256`);

    expect(Buffer.from(sidecar?.content ?? []).toString()).toBe(`${sha256}  ${november}\n`);
    expect(drive.named(`${NAME}.sha256`)).toHaveLength(1);
  });

  it('keeps the ZIP and reports the sidecar as failed when only the sidecar fails', async () => {
    const { drive, logs, storage } = setup();

    drive.add({ name: '2026' });
    drive.onStart = (attempt) => (attempt === 2 ? googleError(400, 'badRequest') : undefined);

    const result = await storage.upload(await fileUpload(randomBytes(1000)));

    expect(result).toMatchObject({ sidecar: 'failed', uploaded: true });
    expect(drive.named(NAME)).toHaveLength(1);
    expect(
      logs.some(
        (line) =>
          line.includes('drive.sidecar.failed') && line.includes('INTEGRATION_UNCLASSIFIED'),
      ),
    ).toBe(true);
  });

  it('writes no sidecar when WRITE_SHA256_SIDECAR is off', async () => {
    const { drive, storage } = setup({ writeSidecar: false });

    drive.add({ name: '2026' });

    await expect(storage.upload(await fileUpload(randomBytes(10)))).resolves.toMatchObject({
      sidecar: 'disabled',
    });
    expect(drive.named(`${NAME}.sha256`)).toEqual([]);
  });

  it('fails with DRIVE_ROOT_INACCESSIBLE when Drive refuses the file in the year folder', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });
    drive.onStart = () => googleError(403, 'appNotAuthorizedToFile');

    await expect(storage.upload(await fileUpload(randomBytes(10)))).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
      message: 'Cannot create a file in the year folder (HTTP 403, appNotAuthorizedToFile)',
    });
  });

  it('leaves other refusals, such as a full Drive, unclassified', async () => {
    const { drive, storage } = setup();

    drive.add({ name: '2026' });
    drive.onStart = () => googleError(403, 'storageQuotaExceeded');

    await expect(storage.upload(await fileUpload(randomBytes(10)))).rejects.toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      reason: 'storageQuotaExceeded',
    });
  });

  it('with APP_ENV=dev, uploads to _dev/<YYYY>/', async () => {
    const { drive, storage } = setup({ devFolder: true });

    drive.add({ name: '2026' });

    const result = await storage.upload(await fileUpload(randomBytes(10)));
    const [dev] = drive.named('_dev');

    expect(drive.files.get(result.yearFolderId)).toMatchObject({
      name: '2026',
      parents: [dev?.id],
    });
    expect(
      drive
        .childrenOf(result.yearFolderId)
        .map((file) => file.name)
        .toSorted(),
    ).toEqual([NAME, `${NAME}.sha256`]);
  });

  describe('a stream', () => {
    it('is hashed while it uploads; its SHA-256 is recorded once Drive confirms it', async () => {
      const { drive, storage } = setup();
      const content = randomBytes(UPLOAD_CHUNK_UNIT + 500);

      drive.add({ name: '2026' });

      const result = await storage.upload({
        content: { kind: 'stream', stream: piecesOf(content, 64 * 1024) },
        fileName: NAME,
        jobId: '2026-10',
        period: '2026-10',
      });

      expect(result).toMatchObject({
        sha256: sha256Of(content),
        sidecar: 'written',
        sizeBytes: content.length,
        uploaded: true,
      });
      expect(drive.files.get(result.driveFileId)?.appProperties).toEqual({
        notionBackupJobId: '2026-10',
        notionBackupPeriod: '2026-10',
        notionBackupSha256: sha256Of(content),
      });
      await expect(storage.findExisting({ period: '2026-10' })).resolves.toMatchObject({
        driveFileId: result.driveFileId,
      });
    });

    it('ends on abort while the stream stalls, and leaves no file', async () => {
      const controller = new AbortController();
      const { drive, storage } = setup();
      const year = drive.add({ name: '2026' });

      async function* stalling(): AsyncGenerator<Uint8Array> {
        yield randomBytes(100);
        controller.abort(new Error('transfer budget exceeded'));
        await new Promise<never>(() => {
          // The stream never delivers another byte.
        });
      }

      await expect(
        storage.upload({
          content: { kind: 'stream', stream: stalling() },
          fileName: NAME,
          jobId: '2026-10',
          period: '2026-10',
          signal: controller.signal,
        }),
      ).rejects.toThrow('transfer budget exceeded');
      expect(drive.childrenOf(year.id)).toEqual([]);
    });

    it('reports a duplicate that Drive refuses to delete', async () => {
      const { drive, logs, storage } = setup();
      const content = randomBytes(1000);

      drive.add({ name: '2026' });

      const first = await storage.upload(await fileUpload(content));

      drive.google.on('DELETE', `${FILES}/*`, () =>
        googleError(403, 'insufficientFilePermissions'),
      );

      const again = await storage.upload({
        content: { kind: 'stream', stream: piecesOf(content, 100) },
        fileName: NAME,
        jobId: '2026-10',
        period: '2026-10',
      });
      const duplicate = drive.named(NAME).find((file) => file.id !== first.driveFileId);

      expect(again).toEqual({
        ...first,
        leftoverFileId: duplicate?.id,
        sidecar: 'exists',
        uploaded: false,
      });
      // Unmarked, so it is never adopted.
      expect(duplicate?.appProperties).not.toHaveProperty('notionBackupSha256');
      expect(logs.some((line) => line.includes('drive.backup.duplicate_kept'))).toBe(true);
    });

    it('keeps a verified copy with the same SHA-256 and deletes the new upload', async () => {
      const { drive, storage } = setup();
      const content = randomBytes(1000);

      drive.add({ name: '2026' });

      const first = await storage.upload(await fileUpload(content));
      const again = await storage.upload({
        content: { kind: 'stream', stream: piecesOf(content, 100) },
        fileName: NAME,
        jobId: '2026-10',
        period: '2026-10',
      });

      expect(again).toEqual({ ...first, sidecar: 'exists', uploaded: false });
      expect(drive.named(NAME).map((file) => file.id)).toEqual([first.driveFileId]);
    });

    it('deletes the upload when the copy lookup fails', async () => {
      const { drive, storage } = setup();

      drive.add({ name: '2026' });
      // Only the lookup after the upload asks for ZIPs with a SHA-256.
      drive.google.on('GET', FILES, ({ url }) =>
        url.searchParams.get('q')?.includes('notionBackupSha256') === true
          ? googleError(400, 'invalidQuery')
          : Response.json({
              files: drive.childrenOf(ROOT_ID).map(({ id, name }) => ({ id, name })),
            }),
      );

      await expect(
        storage.upload({
          content: { kind: 'stream', stream: piecesOf(randomBytes(100), 10) },
          fileName: NAME,
          jobId: '2026-10',
          period: '2026-10',
        }),
      ).rejects.toMatchObject({ code: 'INTEGRATION_UNCLASSIFIED' });
      // It was uploaded, then deleted.
      expect(drive.sessionCount).toBe(1);
      expect(drive.named(NAME)).toEqual([]);
    });

    it('deletes the upload when its SHA-256 cannot be recorded', async () => {
      const { drive, storage } = setup();

      drive.add({ name: '2026' });
      drive.google.on('PATCH', `${FILES}/*`, () => googleError(400, 'badRequest'));

      await expect(
        storage.upload({
          content: { kind: 'stream', stream: piecesOf(randomBytes(100), 10) },
          fileName: NAME,
          jobId: '2026-10',
          period: '2026-10',
        }),
      ).rejects.toMatchObject({ code: 'INTEGRATION_UNCLASSIFIED' });
      expect(drive.named(NAME)).toEqual([]);
    });
  });
});
