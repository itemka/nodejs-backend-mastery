import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

import { DriveBackupStorage } from '../../../src/adapters/drive/drive-backup-storage.js';
import {
  ResumableUploader,
  UPLOAD_CHUNK_UNIT,
} from '../../../src/adapters/drive/resumable-upload.js';
import { GoogleApiClient } from '../../../src/adapters/google/google-api-client.js';
import { keyPrefixFor } from '../../../src/adapters/persistence/keys.js';
import { RedisSecretStore } from '../../../src/adapters/persistence/redis-secret-store.js';
import { TmpExportTransfer } from '../../../src/adapters/transfer/export-transfer.js';
import { HttpDownloader } from '../../../src/adapters/transfer/http-downloader.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import type { SecretStore, TransferRequest } from '../../../src/application/ports.js';
import type { TransferMarker } from '../../../src/domain/statuses.js';
import { digestsOf } from '../../../src/shared/digests.js';
import { createEnvelopeKey } from '../../../src/shared/envelope-crypto.js';
import { createLogger } from '../../../src/shared/logger.js';
import { SecretValue } from '../../../src/shared/secret-value.js';
import { FakeDrive } from '../../support/fake-drive.js';
import { FakeRedis } from '../../support/fake-redis.js';
import { ManualClock } from '../../support/manual-clock.js';
import {
  accessDenied,
  FILE_HOST,
  fileUrl,
  MAILGUN_HOST,
  MAILGUN_LINK,
  NotionHosts,
  redirectTo,
  serveBytes,
  stallAfter,
} from '../../support/notion-hosts.js';
import { zipFixture } from '../../support/zip-fixtures.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const EXPIRES = new Date(NOW.getTime() + 7 * 24 * 3600 * 1000);
const NAME = 'notion-workspace-2026-10-01.zip';
const FILE_TOKEN = `file_token=${'f'.repeat(40)}`;
const tokenProvider = { getAccessToken: () => Promise.resolve('fake-access-token') };
const noWait = () => Promise.resolve();

/** A saved session: the download cookie plus cookies that must stay away from the file host. */
const SESSION = JSON.stringify({
  cookies: [
    {
      domain: '.notion.com',
      expires: NOW.getTime() / 1000 + 365 * 24 * 3600,
      httpOnly: true,
      name: 'file_token',
      path: '/',
      sameSite: 'Lax',
      secure: true,
      value: 'f'.repeat(40),
    },
    {
      domain: '.app.notion.com',
      expires: -1,
      httpOnly: true,
      name: 'token_v2',
      path: '/',
      sameSite: 'Lax',
      secure: true,
      value: 'v'.repeat(40),
    },
  ],
  origins: [],
});

const secretsWith = (value: string): Pick<SecretStore, 'get'> => ({
  get: () => Promise.resolve({ createdAt: NOW.toISOString(), meta: {}, value }),
});

const key = createEnvelopeKey(Buffer.alloc(32, 7).toString('base64'));
const otherKey = createEnvelopeKey(Buffer.alloc(32, 8).toString('base64'));

/** The real encrypted store on a fake Redis: empty unless a test saves a session. */
function savedSession(redis = new FakeRedis(), envelopeKey = key): RedisSecretStore {
  return new RedisSecretStore({
    appEnv: 'dev',
    key: envelopeKey,
    keyPrefix: keyPrefixFor('dev'),
    redis,
  });
}

async function setup({
  expiresAt = EXPIRES,
  secrets = secretsWith(SESSION),
}: { expiresAt?: Date; secrets?: Pick<SecretStore, 'get'> } = {}) {
  const hosts = await NotionHosts.start();
  const drive = new FakeDrive();
  const clock = new ManualClock(NOW);
  const logs: string[] = [];
  const steps: TransferMarker[] = [];
  const parent = await mkdtemp(path.join(tmpdir(), 'nba-transfer-'));
  const directory = path.join(parent, 'nba');

  onTestFinished(() => rm(parent, { force: true, recursive: true }));

  const yearFolder = drive.add({ name: '2026' });
  const logger = createLogger({
    level: 'debug',
    sink: (_level, line) => {
      logs.push(line);
    },
  });
  const transfer = new TmpExportTransfer({
    clock,
    directory,
    downloader: new HttpDownloader({ clock, fetch: hosts.fetch, logger, sleep: noWait }),
    emailFinder: { getDownloadLink: () => Promise.resolve(new SecretValue(MAILGUN_LINK)) },
    logger,
    secrets,
    storage: new DriveBackupStorage({
      api: new GoogleApiClient({
        fetch: drive.fetch,
        service: 'drive',
        sleep: noWait,
        tokenProvider,
      }),
      devFolder: false,
      logger,
      rootFolderId: 'root-folder-id',
      sleep: noWait,
      uploader: new ResumableUploader({
        chunkSize: UPLOAD_CHUNK_UNIT,
        fetch: drive.fetch,
        sleep: noWait,
        tokenProvider,
      }),
      writeSidecar: true,
    }),
  });

  hosts.on(MAILGUN_HOST, redirectTo(fileUrl(expiresAt)));

  const run = (overrides: Partial<TransferRequest> = {}) =>
    transfer.run({
      emailMessageId: '19a14c443e1f2d3c',
      fileName: NAME,
      jobId: '2026-10',
      onStep: (marker) => {
        steps.push(marker);

        return Promise.resolve();
      },
      period: '2026-10',
      ...overrides,
    });

  return { clock, directory, drive, hosts, logs, run, steps, yearFolder };
}

async function exists(directory: string): Promise<boolean> {
  return readdir(directory).then(
    () => true,
    () => false,
  );
}

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(IntegrationError);

  return error as IntegrationError;
}

describe('TmpExportTransfer', () => {
  it('downloads, verifies and uploads the ZIP, then removes its directory', async () => {
    const zip = await readFile(zipFixture('notion-export.zip'));
    const { directory, drive, hosts, logs, run, steps, yearFolder } = await setup();

    hosts.on(FILE_HOST, serveBytes(zip));

    const result = await run();
    const { sha256, sizeBytes } = digestsOf(zip);

    expect(result).toMatchObject({
      backup: { fileName: NAME, jobId: '2026-10', sha256, sizeBytes, uploaded: true },
      entryCount: 4,
      outcome: 'stored',
    });
    expect(steps).toEqual(['DOWNLOADING', 'VERIFYING', 'UPLOADING']);

    const [stored] = drive.named(NAME);

    expect(stored?.parents).toEqual([yearFolder.id]);
    expect(stored?.content).toEqual(new Uint8Array(zip));
    expect(stored?.appProperties).toMatchObject({ notionBackupSha256: sha256 });
    expect(await exists(directory)).toBe(false);

    // Mailgun gets no cookie; the file host gets only the cookie that matches it.
    expect(hosts.requestsTo(MAILGUN_HOST).map((item) => item.cookie)).toEqual([undefined]);
    expect(hosts.requestsTo(FILE_HOST).map((item) => item.cookie)).toEqual([FILE_TOKEN]);

    const text = logs.join('\n');

    expect(text).toContain('transfer.download.done');
    expect(text).toContain('transfer.verify.done');
    expect(text).toContain('transfer.upload.done');
    expect(text).not.toMatch(/file_token|token_v2|signature|\/c\/t|Export-|Dashboard/);
  });

  it('ends an expired link without a request to the file host', async () => {
    const { drive, hosts, run, steps } = await setup({ expiresAt: new Date(NOW.getTime() - 1) });

    await expect(run()).resolves.toEqual({ outcome: 'link_expired' });
    expect(hosts.requestsTo(FILE_HOST)).toHaveLength(0);
    expect(steps).toEqual([]);
    expect(drive.named(NAME)).toEqual([]);
  });

  it('ends with an expired link when the expiry passes during the download', async () => {
    const { clock, directory, hosts, run, steps } = await setup();

    hosts.on(FILE_HOST, (request, response) => {
      clock.advance(EXPIRES.getTime() - NOW.getTime());
      accessDenied(request, response);
    });

    await expect(run()).resolves.toEqual({ outcome: 'link_expired' });
    expect(steps).toEqual(['DOWNLOADING']);
    expect(await exists(directory)).toBe(false);
  });

  it('reports a 403 before the expiry as NOTION_SESSION_EXPIRED', async () => {
    const { directory, drive, hosts, run, steps } = await setup();

    hosts.on(FILE_HOST, accessDenied);

    const error = await rejection(run());

    expect(error.code).toBe('NOTION_SESSION_EXPIRED');
    expect(steps).toEqual(['DOWNLOADING']);
    expect(drive.named(NAME)).toEqual([]);
    expect(await exists(directory)).toBe(false);
  });

  it.each<[string, () => Promise<Pick<SecretStore, 'get'>>, string]>([
    ['no saved session', () => Promise.resolve(savedSession()), 'No Notion session is saved'],
    [
      'a session saved with another key',
      async () => {
        const redis = new FakeRedis();

        await savedSession(redis, otherKey).put('notion-storage-state', SESSION);

        return savedSession(redis);
      },
      'The saved Notion session cannot be opened (KEY_MISMATCH)',
    ],
    [
      'a session without a file-host cookie',
      async () => {
        const store = savedSession();

        await store.put('notion-storage-state', JSON.stringify({ cookies: [], origins: [] }));

        return store;
      },
      'The saved Notion session has no unexpired cookie for file.notion.com',
    ],
  ])(
    'reports %s as NOTION_SESSION_EXPIRED before downloading',
    async (_case, makeStore, message) => {
      const { hosts, run, steps } = await setup({ secrets: await makeStore() });

      expect(await rejection(run())).toMatchObject({ code: 'NOTION_SESSION_EXPIRED', message });
      expect(hosts.requestsTo(FILE_HOST)).toHaveLength(0);
      expect(steps).toEqual([]);
    },
  );

  it('rejects an invalid ZIP without uploading it', async () => {
    const zip = await readFile(zipFixture('truncated.zip'));
    const { directory, drive, hosts, run, steps } = await setup();

    hosts.on(FILE_HOST, serveBytes(zip));

    const error = await rejection(run());

    expect(error.code).toBe('ZIP_INVALID');
    expect(steps).toEqual(['DOWNLOADING', 'VERIFYING']);
    expect(drive.named(NAME)).toEqual([]);
    expect(await exists(directory)).toBe(false);
  });

  it('leaves the directory empty when the budget runs out during the download', async () => {
    const zip = await readFile(zipFixture('notion-export.zip'));
    const { directory, drive, hosts, run } = await setup();
    const controller = new AbortController();
    const reason = new Error('transfer budget');

    hosts.on(
      FILE_HOST,
      stallAfter(zip, 500, () => {
        controller.abort(reason);
      }),
    );

    await expect(run({ signal: controller.signal })).rejects.toBe(reason);
    expect(drive.named(NAME)).toEqual([]);
    expect(await exists(directory)).toBe(false);
  });

  it('removes what a killed earlier run left behind before downloading', async () => {
    const zip = await readFile(zipFixture('notion-export.zip'));
    const { directory, hosts, run } = await setup();
    const leftover = path.join(directory, '2026-09.zip.part');
    let leftoverDuringDownload: boolean | undefined;

    await mkdir(directory, { recursive: true });
    await writeFile(leftover, 'stale');
    hosts.on(FILE_HOST, async (request, response) => {
      leftoverDuringDownload = await readFile(leftover).then(
        () => true,
        () => false,
      );
      serveBytes(zip)(request, response);
    });

    await expect(run()).resolves.toMatchObject({ outcome: 'stored' });
    expect(leftoverDuringDownload).toBe(false);
  });

  it('leaves the directory empty when the budget runs out before the upload', async () => {
    const zip = await readFile(zipFixture('notion-export.zip'));
    const { directory, drive, hosts, run } = await setup();
    const controller = new AbortController();
    const reason = new Error('transfer budget');

    hosts.on(FILE_HOST, serveBytes(zip));

    const stopped = run({
      onStep: (marker) => {
        if (marker === 'UPLOADING') {
          controller.abort(reason);
        }

        return Promise.resolve();
      },
      signal: controller.signal,
    });

    await expect(stopped).rejects.toBe(reason);
    expect(drive.named(NAME)).toEqual([]);
    expect(await exists(directory)).toBe(false);
  });

  it('stops when the job cannot save a progress marker', async () => {
    const zip = await readFile(zipFixture('notion-export.zip'));
    const { directory, drive, hosts, run } = await setup();
    const conflict = new Error('version conflict');

    hosts.on(FILE_HOST, serveBytes(zip));

    const stopped = run({
      onStep: (marker) => (marker === 'VERIFYING' ? Promise.reject(conflict) : Promise.resolve()),
    });

    await expect(stopped).rejects.toBe(conflict);
    expect(drive.named(NAME)).toEqual([]);
    expect(await exists(directory)).toBe(false);
  });

  it('refuses a job ID that is not one, since it names the file', async () => {
    const { hosts, run } = await setup();

    await expect(run({ jobId: '../2026-10' })).rejects.toThrow(RangeError);
    expect(hosts.requests).toHaveLength(0);
  });

  it('stops with the reason of a signal aborted before the run', async () => {
    const { hosts, run } = await setup();
    const reason = new Error('transfer budget');

    await expect(run({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(hosts.requests).toHaveLength(0);
  });
});
