import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import type {
  DriveUploadMetadata,
  ResumableUploaderOptions,
  UploadSource,
} from '../../../src/adapters/drive/resumable-upload.js';
import {
  bytesSource,
  HashingStreamSource,
  openFileSource,
  ResumableUploader,
  UPLOAD_CHUNK_UNIT,
} from '../../../src/adapters/drive/resumable-upload.js';
import { FakeDrive, ROOT_ID } from '../../support/fake-drive.js';
import { googleError } from '../../support/fake-google.js';
import { tempFile } from '../../support/temp-file.js';

const UNIT = UPLOAD_CHUNK_UNIT;
const MiB = 1024 * 1024;
const NAME = 'notion-workspace-2026-10-01.zip';

const metadata: DriveUploadMetadata = {
  appProperties: { notionBackupPeriod: '2026-10' },
  mimeType: 'application/zip',
  name: NAME,
  parents: [ROOT_ID],
};

const tokenProvider = { getAccessToken: () => Promise.resolve('fake-access-token') };

function setup(options: Partial<ResumableUploaderOptions> = {}) {
  const drive = new FakeDrive();
  const sleeps: number[] = [];
  const uploader = new ResumableUploader({
    chunkSize: UNIT,
    fetch: drive.fetch,
    sleep: (ms) => {
      sleeps.push(ms);

      return Promise.resolve();
    },
    tokenProvider,
    ...options,
  });

  return { drive, sleeps, uploader };
}

/** An async stream of `content` in pieces of `pieceSize`, like a `fetch` body. */
async function* piecesOf(content: Uint8Array, pieceSize: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < content.length; offset += pieceSize) {
    await Promise.resolve();
    yield content.slice(offset, offset + pieceSize);
  }
}

function stored(drive: FakeDrive, fileId: string): Buffer {
  return Buffer.from(drive.files.get(fileId)?.content ?? []);
}

function range(start: number, end: number, total: number | '*'): string {
  return `bytes ${start}-${end - 1}/${total}`;
}

describe('ResumableUploader', () => {
  it('sends 16 MiB chunks by default with the total size; the file exists after the last one', async () => {
    const drive = new FakeDrive();
    const uploader = new ResumableUploader({ fetch: drive.fetch, tokenProvider });
    const total = 32 * MiB + 1000;
    const content = randomBytes(total);

    const { fileId } = await uploader.upload(metadata, bytesSource(content));

    expect(drive.contentRanges).toEqual([
      range(0, 16 * MiB, total),
      range(16 * MiB, 32 * MiB, total),
      range(32 * MiB, total, total),
    ]);
    expect(stored(drive, fileId).equals(content)).toBe(true);
    expect(drive.named(NAME)).toHaveLength(1);

    const [start] = drive.google.requestsTo('www.googleapis.com/upload/drive/v3/files');

    expect(start?.method).toBe('POST');
    expect(start?.url.searchParams.get('uploadType')).toBe('resumable');
    expect(start?.headers.get('authorization')).toBe('Bearer fake-access-token');
    expect(start?.headers.get('x-upload-content-length')).toBe(String(total));
    expect(start?.headers.get('x-upload-content-type')).toBe('application/zip');
    expect(JSON.parse(start?.body ?? '')).toEqual(metadata);
  });

  it('continues from the Range Drive reports when it kept only part of a chunk (308)', async () => {
    const { drive, uploader } = setup();
    const total = 3 * UNIT + 100;
    const content = randomBytes(total);

    drive.onChunk = ({ index }) => (index === 2 ? { persist: 1000 } : undefined);

    const { fileId } = await uploader.upload(metadata, bytesSource(content));

    expect(drive.contentRanges).toEqual([
      range(0, UNIT, total),
      range(UNIT, 2 * UNIT, total),
      range(UNIT + 1000, 2 * UNIT + 1000, total),
      range(2 * UNIT + 1000, total, total),
    ]);
    expect(stored(drive, fileId).equals(content)).toBe(true);
  });

  it('asks Drive for the position after a 503, then sends the chunk again', async () => {
    const { drive, sleeps, uploader } = setup();
    const total = 2 * UNIT + 5;
    const content = randomBytes(total);

    drive.onChunk = ({ index }) =>
      index === 2 ? { response: () => googleError(503, 'backendError') } : undefined;

    const { fileId } = await uploader.upload(metadata, bytesSource(content));

    expect(drive.contentRanges).toEqual([
      range(0, UNIT, total),
      range(UNIT, 2 * UNIT, total),
      `bytes */${total}`,
      range(UNIT, 2 * UNIT, total),
      range(2 * UNIT, total, total),
    ]);
    expect(sleeps).toEqual([500]);
    expect(stored(drive, fileId).equals(content)).toBe(true);
  });

  it('waits out a short Retry-After on a 429', async () => {
    const { drive, sleeps, uploader } = setup();

    drive.onChunk = ({ index }) =>
      index === 1
        ? { response: () => googleError(429, 'rateLimitExceeded', { 'Retry-After': '3' }) }
        : undefined;

    await uploader.upload(metadata, bytesSource(randomBytes(10)));

    expect(sleeps).toEqual([3000]);
    expect(drive.contentRanges).toEqual(['bytes 0-9/10', 'bytes */10', 'bytes 0-9/10']);
  });

  it('passes a long Retry-After on as DRIVE_UNAVAILABLE without waiting', async () => {
    const { drive, sleeps, uploader } = setup();

    drive.onChunk = () => ({
      response: () => googleError(503, undefined, { 'Retry-After': '120' }),
    });

    await expect(uploader.upload(metadata, bytesSource(randomBytes(10)))).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      retryAfterSec: 120,
    });
    expect(sleeps).toEqual([]);
    expect(drive.named(NAME)).toEqual([]);
  });

  it('gives up with DRIVE_UNAVAILABLE after 5 failures in a row without progress', async () => {
    const { drive, sleeps, uploader } = setup();

    drive.onChunk = ({ start }) =>
      start === UNIT ? { response: () => googleError(500, 'backendError') } : undefined;

    await expect(
      uploader.upload(metadata, bytesSource(randomBytes(2 * UNIT))),
    ).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
    });
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
    expect(drive.contentRanges.filter((value) => value.startsWith(`bytes ${UNIT}-`))).toHaveLength(
      5,
    );
    expect(drive.named(NAME)).toEqual([]);
  });

  it('backs off, then gives up, when Drive keeps none of a chunk', async () => {
    const { drive, sleeps, uploader } = setup();

    drive.onChunk = () => ({ persist: 0 });

    await expect(uploader.upload(metadata, bytesSource(randomBytes(10)))).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      message: 'Drive kept none of the uploaded bytes',
    });
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
    expect(drive.contentRanges).toHaveLength(5);
  });

  it('does not send a chunk again when only the response was lost', async () => {
    const { drive, sleeps, uploader } = setup();
    const total = 2 * UNIT;
    const content = randomBytes(total);

    drive.onChunk = ({ index }) =>
      index === 1 ? { networkError: true, persist: UNIT } : undefined;

    const { fileId } = await uploader.upload(metadata, bytesSource(content));

    expect(drive.contentRanges).toEqual([
      range(0, UNIT, total),
      `bytes */${total}`,
      range(UNIT, 2 * UNIT, total),
    ]);
    expect(sleeps).toEqual([500]);
    expect(stored(drive, fileId).equals(content)).toBe(true);
  });

  it('finds the file when the response to the last chunk was lost, and creates no second one', async () => {
    const { drive, uploader } = setup();
    const total = UNIT + 10;

    drive.onChunk = ({ index }) => (index === 2 ? { networkError: true, persist: 10 } : undefined);

    const { fileId } = await uploader.upload(metadata, bytesSource(randomBytes(total)));

    expect(drive.contentRanges).toEqual([
      range(0, UNIT, total),
      range(UNIT, total, total),
      `bytes */${total}`,
    ]);
    expect(drive.named(NAME).map((file) => file.id)).toEqual([fileId]);
  });

  it('starts a new session from byte 0 when Drive expires the session (404)', async () => {
    const { drive, uploader } = setup();
    const total = 2 * UNIT + 1;
    const content = randomBytes(total);

    drive.onChunk = ({ index }) => (index === 2 ? { expire: true } : undefined);

    const { fileId } = await uploader.upload(metadata, bytesSource(content));

    expect(drive.sessionCount).toBe(2);
    expect(drive.contentRanges).toEqual([
      range(0, UNIT, total),
      range(UNIT, 2 * UNIT, total),
      range(0, UNIT, total),
      range(UNIT, 2 * UNIT, total),
      range(2 * UNIT, total, total),
    ]);
    expect(stored(drive, fileId).equals(content)).toBe(true);
    expect(drive.named(NAME)).toHaveLength(1);
  });

  it('gives up after 3 expired sessions', async () => {
    const { drive, uploader } = setup();

    drive.onChunk = () => ({ expire: true });

    await expect(uploader.upload(metadata, bytesSource(randomBytes(10)))).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      message: 'Drive expired 3 upload sessions in a row',
    });
    expect(drive.sessionCount).toBe(3);
  });

  it('cannot start a stream again after its session expired', async () => {
    const { drive, uploader } = setup();
    const content = randomBytes(2 * UNIT);

    drive.onChunk = ({ index }) => (index === 2 ? { expire: true } : undefined);

    await expect(
      uploader.upload(metadata, new HashingStreamSource(piecesOf(content, 64 * 1024))),
    ).rejects.toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      message: 'The Drive upload session expired, and a stream cannot be sent again',
    });
    expect(drive.sessionCount).toBe(1);
  });

  it('retries the session start after a 503: no file exists before the first chunk', async () => {
    const { drive, sleeps, uploader } = setup();

    drive.onStart = (attempt) => (attempt === 1 ? googleError(503, 'backendError') : undefined);

    await uploader.upload(metadata, bytesSource(randomBytes(10)));

    expect(sleeps).toEqual([500]);
    expect(drive.sessionCount).toBe(1);
    expect(drive.named(NAME)).toHaveLength(1);
  });

  it('refuses a session URL that is not Drive’s upload endpoint, and sends it nothing', async () => {
    const { drive, uploader } = setup();

    drive.locationFor = (sessionId) =>
      `https://uploads.example.com/upload/drive/v3/files?upload_id=${sessionId}`;

    await expect(uploader.upload(metadata, bytesSource(randomBytes(10)))).rejects.toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: 'Drive returned an unexpected upload session URL',
    });
    expect(drive.google.requests.filter((request) => request.method === 'PUT')).toEqual([]);
  });

  it('stops on a 401 with GOOGLE_AUTH_REQUIRED, without retrying', async () => {
    const { drive, sleeps, uploader } = setup();

    drive.onChunk = () => ({ response: () => googleError(401) });

    await expect(uploader.upload(metadata, bytesSource(randomBytes(10)))).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
    });
    expect(sleeps).toEqual([]);
    expect(drive.contentRanges).toHaveLength(1);
  });

  it('rejects a Range beyond the bytes sent', async () => {
    const { drive, uploader } = setup();

    drive.onChunk = () => ({
      response: () =>
        new Response(undefined, { headers: { Range: 'bytes=0-999999' }, status: 308 }),
    });

    await expect(
      uploader.upload(metadata, bytesSource(randomBytes(2 * UNIT))),
    ).rejects.toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: 'Drive reported an upload position that does not match the bytes sent',
    });
  });

  it('stops when the signal aborts, with its reason', async () => {
    const { drive, uploader } = setup();
    const controller = new AbortController();

    drive.onChunk = ({ index, length }) => {
      if (index === 1) {
        controller.abort(new Error('transfer budget exceeded'));
      }

      // Drive keeps the chunk; the abort stops the next request.
      return { persist: length };
    };

    await expect(
      uploader.upload(metadata, bytesSource(randomBytes(2 * UNIT)), controller.signal),
    ).rejects.toThrow('transfer budget exceeded');
    expect(drive.contentRanges).toHaveLength(1);
  });

  it('rejects a chunk size that is not a multiple of 256 KiB', () => {
    expect(() => new ResumableUploader({ chunkSize: 1000, tokenProvider })).toThrow(RangeError);
  });

  describe('a stream of unknown size', () => {
    it('sends "*" as the total until the last chunk, and hashes every byte once', async () => {
      const { drive, uploader } = setup();
      const total = 2 * UNIT + UNIT / 2;
      const content = randomBytes(total);
      const source = new HashingStreamSource(piecesOf(content, 100 * 1024));

      const { fileId } = await uploader.upload(metadata, source);

      expect(drive.contentRanges).toEqual([
        range(0, UNIT, '*'),
        range(UNIT, 2 * UNIT, '*'),
        range(2 * UNIT, total, total),
      ]);
      expect(stored(drive, fileId).equals(content)).toBe(true);
      expect(source.digests()).toEqual({
        md5: createHash('md5').update(content).digest('hex'),
        sha256: createHash('sha256').update(content).digest('hex'),
        sizeBytes: total,
      });

      const [start] = drive.google.requestsTo('www.googleapis.com/upload/drive/v3/files');

      expect(start?.headers.get('x-upload-content-length')).toBeNull();
    });

    it('names the total with the last chunk when the stream ends on a chunk boundary', async () => {
      const { drive, uploader } = setup();
      const content = randomBytes(2 * UNIT);

      await uploader.upload(metadata, new HashingStreamSource(piecesOf(content, UNIT / 2)));

      expect(drive.contentRanges).toEqual([range(0, UNIT, '*'), range(UNIT, 2 * UNIT, 2 * UNIT)]);
    });

    it('finishes an empty stream with "bytes */0"', async () => {
      const { drive, uploader } = setup();

      const { fileId } = await uploader.upload(
        metadata,
        new HashingStreamSource(piecesOf(new Uint8Array(), 1)),
      );

      expect(drive.contentRanges).toEqual(['bytes */0']);
      expect(stored(drive, fileId)).toHaveLength(0);
    });

    it('sends the unconfirmed rest of a chunk from its buffer', async () => {
      const { drive, uploader } = setup();
      const total = 2 * UNIT;
      const content = randomBytes(total);

      drive.onChunk = ({ index }) => (index === 1 ? { persist: 1000 } : undefined);

      const { fileId } = await uploader.upload(
        metadata,
        new HashingStreamSource(piecesOf(content, 64 * 1024)),
      );

      expect(drive.contentRanges).toEqual([
        range(0, UNIT, '*'),
        range(1000, UNIT + 1000, '*'),
        range(UNIT + 1000, total, total),
      ]);
      expect(stored(drive, fileId).equals(content)).toBe(true);
    });
  });
});

describe('upload sources', () => {
  it('reads a file by position, so the same range can be read again', async () => {
    const content = randomBytes(1000);
    const source = await openFileSource(await tempFile(content));

    try {
      expect(source.size).toBe(1000);
      await expect(source.read(900, 512)).resolves.toEqual({
        bytes: content.subarray(900),
        end: true,
      });
      await expect(source.read(0, 100)).resolves.toEqual({
        bytes: content.subarray(0, 100),
        end: false,
      });
    } finally {
      await source.close();
    }
  });

  it('refuses a directory', async () => {
    await expect(openFileSource(tmpdir())).rejects.toThrow('not a regular file');
  });

  it('a stream cannot read before its last release, and has no digests before its end', async () => {
    const source: UploadSource & { digests(): unknown } = new HashingStreamSource(
      piecesOf(randomBytes(100), 10),
    );

    await source.read(0, 50);
    source.release(40);

    expect(() => source.digests()).toThrow('has not been read to its end');
    await expect(source.read(30, 10)).rejects.toThrow(RangeError);
    await expect(source.read(40, 100)).resolves.toMatchObject({ end: true });
  });
});
