import { open } from 'node:fs/promises';
import { z } from 'zod';

import { IntegrationError } from '../../application/integration-error.js';
import type { GoogleTokenProvider } from '../../application/ports.js';
import { abortable } from '../../shared/abortable.js';
import type { Digests } from '../../shared/digests.js';
import { Digester } from '../../shared/digests.js';
import type { Sleep } from '../../shared/sleep.js';
import { pause, systemSleep } from '../../shared/sleep.js';
import type { GoogleApiError } from '../google/google-api-client.js';
import {
  backoffMs,
  googleApiErrorOf,
  isServiceUnavailable,
  MAX_IN_TICK_DELAY_SEC,
  serviceAccessToken,
  serviceUnavailable,
} from '../google/google-api-client.js';
import { DRIVE_UPLOAD_URL, driveIdSchema } from './drive-schemas.js';

/** Drive takes chunks in multiples of 256 KiB; only the last chunk may be shorter. */
export const UPLOAD_CHUNK_UNIT = 256 * 1024;
export const DEFAULT_UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;

export interface SourceChunk {
  readonly bytes: Uint8Array;
  /** No byte follows this chunk. */
  readonly end: boolean;
}

/**
 * The bytes of one upload. Reads move forward, except that the uploader reads again from the
 * offset Drive last confirmed, which is never before the last `release`.
 */
export interface UploadSource {
  /** Whether a new upload session can read the bytes again from offset 0. */
  readonly restartable: boolean;
  /** The total size, when it is known before the upload. */
  readonly size: number | undefined;
  /** Up to `length` bytes from `offset`; fewer only at the end. */
  read(offset: number, length: number): Promise<SourceChunk>;
  /** Drive holds every byte before `offset`; this session never reads them again. */
  release(offset: number): void;
}

/** Bytes in memory, such as the `.sha256` sidecar. */
export function bytesSource(bytes: Uint8Array): UploadSource {
  return {
    read: (offset, length) => {
      const chunk = bytes.subarray(offset, offset + length);

      return Promise.resolve({ bytes: chunk, end: offset + chunk.length >= bytes.length });
    },
    release: () => {
      // Nothing to free: the bytes stay readable for a restarted session.
    },
    restartable: true,
    size: bytes.length,
  };
}

export interface FileUploadSource extends UploadSource {
  close(): Promise<void>;
  readonly size: number;
}

/** A regular file, read by position, so a restarted session can read it again. */
export async function openFileSource(path: string): Promise<FileUploadSource> {
  const handle = await open(path, 'r');

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new Error('The upload source is not a regular file');
    }

    const { size } = stats;

    return {
      close: () => handle.close(),
      read: async (offset, length) => {
        const wanted = Math.max(0, Math.min(length, size - offset));
        const buffer = Buffer.alloc(wanted);

        for (let filled = 0; filled < wanted; ) {
          const { bytesRead } = await handle.read(buffer, filled, wanted - filled, offset + filled);

          if (bytesRead === 0) {
            throw new Error('The upload source file shrank during the upload');
          }

          filled += bytesRead;
        }

        return { bytes: buffer, end: offset + wanted >= size };
      },
      release: () => {
        // Positional reads keep nothing in memory.
      },
      restartable: true,
      size,
    };
  } catch (error) {
    await handle.close();

    throw error;
  }
}

/**
 * A stream of unknown length, hashed as it is read (`stream` content). It buffers only
 * the bytes Drive has not confirmed yet, plus one read ahead to see where the stream ends.
 * Every byte is pulled and hashed exactly once, so it cannot restart.
 */
export class HashingStreamSource implements UploadSource {
  readonly restartable = false;
  readonly size = undefined;
  #buffered = 0;
  readonly #digester = new Digester();
  #digests: Digests | undefined;
  readonly #iterator: AsyncIterator<Uint8Array, unknown>;
  #pieces: Uint8Array[] = [];
  /** A `next()` is waiting for the stream, such as one an abort left behind. */
  #pulling = false;
  /** The stream offset of the first buffered byte. */
  #start = 0;

  constructor(stream: AsyncIterable<Uint8Array>) {
    this.#iterator = stream[Symbol.asyncIterator]();
  }

  /**
   * Stops reading the stream, if it has not ended. After an abort a `next()` may still wait for a
   * stalled stream; an async iterator answers `return()` only after it, so that is not awaited.
   */
  async close(): Promise<void> {
    if (this.#digests !== undefined) {
      return;
    }

    const closing = this.#iterator.return?.();

    if (this.#pulling) {
      void closing?.catch(() => {
        // The stream is abandoned: its failure to close reaches no one.
      });

      return;
    }

    await closing;
  }

  /** The digests of the whole stream; available once it has ended. */
  digests(): Digests {
    if (this.#digests === undefined) {
      throw new Error('The stream has not been read to its end');
    }

    return this.#digests;
  }

  async read(offset: number, length: number): Promise<SourceChunk> {
    if (offset < this.#start) {
      throw new RangeError('The stream cannot be read before its last release');
    }

    // One byte more than the chunk tells whether the chunk is the last one.
    while (this.#digests === undefined && this.#start + this.#buffered <= offset + length) {
      await this.#pull();
    }

    const available = this.#start + this.#buffered;

    if (offset > available) {
      throw new RangeError('The stream cannot be read past its end');
    }

    const end = Math.min(offset + length, available);

    return {
      bytes: this.#slice(offset, end),
      end: this.#digests !== undefined && end === available,
    };
  }

  release(offset: number): void {
    let drop = offset - this.#start;

    while (drop > 0 && this.#pieces.length > 0) {
      const [first] = this.#pieces;

      if (first === undefined) {
        break;
      }

      const dropped = Math.min(drop, first.length);

      if (dropped === first.length) {
        this.#pieces.shift();
      } else {
        this.#pieces[0] = first.subarray(dropped);
      }

      drop -= dropped;
      this.#start += dropped;
      this.#buffered -= dropped;
    }
  }

  async #pull(): Promise<void> {
    let result: IteratorResult<Uint8Array, unknown>;

    this.#pulling = true;

    try {
      result = await this.#iterator.next();
    } finally {
      this.#pulling = false;
    }

    const { done, value } = result;

    if (done === true) {
      this.#digests = this.#digester.digest();

      return;
    }

    if (value.length > 0) {
      this.#digester.update(value);
      this.#pieces.push(value);
      this.#buffered += value.length;
    }
  }

  #slice(from: number, to: number): Uint8Array {
    const result = Buffer.alloc(to - from);
    let pieceStart = this.#start;
    let written = 0;

    for (const piece of this.#pieces) {
      const pieceEnd = pieceStart + piece.length;

      if (pieceEnd > from && pieceStart < to) {
        const part = piece.subarray(
          Math.max(0, from - pieceStart),
          Math.min(piece.length, to - pieceStart),
        );

        result.set(part, written);
        written += part.length;
      }

      if (pieceEnd >= to) {
        break;
      }

      pieceStart = pieceEnd;
    }

    return result;
  }
}

/** The metadata of the file a resumable upload creates. */
export interface DriveUploadMetadata {
  readonly appProperties: Readonly<Record<string, string>>;
  readonly mimeType: string;
  readonly name: string;
  readonly parents: readonly [string];
}

export interface ResumableUploaderOptions {
  /** A multiple of 256 KiB; default 16 MiB. */
  chunkSize?: number;
  fetch?: typeof fetch;
  /** Failed requests in a row, without progress, before the upload gives up. */
  maxAttempts?: number;
  /** Upload sessions per upload: the first, plus restarts after Drive expires one. */
  maxSessions?: number;
  sleep?: Sleep;
  /** Per request; one chunk must fit. */
  timeoutMs?: number;
  tokenProvider: GoogleTokenProvider;
}

type ChunkOutcome =
  | { readonly committed: number; readonly kind: 'incomplete' }
  | { readonly error: IntegrationError; readonly kind: 'failed' }
  | { readonly fileId: string; readonly kind: 'complete' }
  | { readonly kind: 'expired' };

/** Where one upload session stands. */
interface SessionProgress {
  /** The last request failed, so the next one asks Drive for its position. */
  askStatus: boolean;
  /** Failed requests in a row without progress. */
  failures: number;
  /** Drive holds every byte before this offset. */
  offset: number;
  /** The end of the bytes sent so far. */
  sent: number;
  /** The total size, once known. */
  total: number | undefined;
}

const uploadedFileSchema = z.object({ id: driveIdSchema });
const committedRangePattern = /^bytes=0-(\d{1,15})$/;
const uploadOrigin = new URL(DRIVE_UPLOAD_URL);

/**
 * Drive's resumable upload protocol. The file exists only after the last chunk, so a failed
 * upload leaves nothing behind.
 * - A transient failure (network, timeout, 429, 5xx, rate-limit 403) asks Drive how many bytes
 *   it holds, then resumes from there. `maxAttempts` failures in a row without progress, or a
 *   `Retry-After` beyond the in-tick limit, end the upload with `DRIVE_UNAVAILABLE`.
 * - `308` + `Range` names the bytes Drive holds; the next chunk starts right after them.
 * - `404` or `410`: the session expired. A restartable source starts a new session.
 * - Redirects are never followed, and the bearer token goes only to Drive's upload URL.
 * The session URL is as sensitive as a token: it is kept in memory and never logged.
 */
export class ResumableUploader {
  private readonly chunkSize: number;
  private readonly fetch: typeof fetch;
  private readonly maxAttempts: number;
  private readonly maxSessions: number;
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;
  private readonly tokenProvider: GoogleTokenProvider;

  constructor({
    chunkSize = DEFAULT_UPLOAD_CHUNK_SIZE,
    fetch = globalThis.fetch,
    maxAttempts = 5,
    maxSessions = 3,
    sleep = systemSleep,
    timeoutMs = 120_000,
    tokenProvider,
  }: ResumableUploaderOptions) {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize % UPLOAD_CHUNK_UNIT !== 0) {
      throw new RangeError('The chunk size must be a positive multiple of 256 KiB');
    }

    this.chunkSize = chunkSize;
    this.fetch = fetch;
    this.maxAttempts = maxAttempts;
    this.maxSessions = maxSessions;
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
    this.tokenProvider = tokenProvider;
  }

  /** Uploads every byte of `source` into a new file; returns its ID once Drive created it. */
  async upload(
    metadata: DriveUploadMetadata,
    source: UploadSource,
    signal?: AbortSignal,
  ): Promise<{ fileId: string }> {
    for (let session = 1; session <= this.maxSessions; session += 1) {
      const sessionUrl = await this.startSession(metadata, source.size, signal);
      const result = await this.sendAll(sessionUrl, source, signal);

      if (result !== 'expired') {
        return result;
      }

      if (!source.restartable) {
        throw new IntegrationError(
          'DRIVE_UNAVAILABLE',
          'The Drive upload session expired, and a stream cannot be sent again',
        );
      }
    }

    throw new IntegrationError(
      'DRIVE_UNAVAILABLE',
      `Drive expired ${this.maxSessions} upload sessions in a row`,
    );
  }

  /**
   * Waits before the next attempt, or throws `error` when no attempt is left. An abort ends the
   * wait at once.
   */
  private async backOff(
    error: IntegrationError,
    failures: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const delaySec = error.retryAfterSec ?? backoffMs(failures) / 1000;

    if (failures >= this.maxAttempts || delaySec > MAX_IN_TICK_DELAY_SEC) {
      throw error;
    }

    await pause(this.sleep, delaySec * 1000, signal);
  }

  /** One request with the bearer token. A network failure or timeout is returned as an error. */
  private async exchange(
    url: URL,
    init: { body?: string | Uint8Array; headers: Record<string, string>; method: string },
    signal: AbortSignal | undefined,
  ): Promise<GoogleApiError | Response> {
    signal?.throwIfAborted();

    // A token refresh takes no signal, so the abort must not wait for it.
    const token = await abortable(serviceAccessToken(this.tokenProvider, 'drive'), signal);
    const timeout = AbortSignal.timeout(this.timeoutMs);

    try {
      return await this.fetch(url, {
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        method: init.method,
        // A 308 is Drive's "resume incomplete"; `redirect: 'error'` would turn it into a failure.
        redirect: 'manual',
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch {
      signal?.throwIfAborted();

      return serviceUnavailable('drive');
    }
  }

  /** Sends one chunk, or with no bytes, asks Drive how far the upload got. */
  private async put(
    sessionUrl: URL,
    contentRange: string,
    bytes: Uint8Array | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ChunkOutcome> {
    const result = await this.exchange(
      sessionUrl,
      {
        ...(bytes === undefined || bytes.length === 0 ? {} : { body: bytes }),
        headers: { 'Content-Range': contentRange },
        method: 'PUT',
      },
      signal,
    );

    if (!(result instanceof Response)) {
      return { error: result, kind: 'failed' };
    }

    if (result.status === 200 || result.status === 201) {
      const reply = await uploadedFileId(result);

      // Drive may have created the file although the reply does not name it: asking the session
      // again returns the file.
      return typeof reply === 'string'
        ? { fileId: reply, kind: 'complete' }
        : { error: reply, kind: 'failed' };
    }

    if (result.status === 308) {
      await result.body?.cancel();

      return { committed: committedBytes(result.headers.get('range')), kind: 'incomplete' };
    }

    if (result.status === 404 || result.status === 410) {
      await result.body?.cancel();

      return { kind: 'expired' };
    }

    const error = await googleApiErrorOf('drive', result, signal);

    if (isServiceUnavailable(error, 'drive')) {
      return { error, kind: 'failed' };
    }

    throw error;
  }

  /**
   * Moves to the offset Drive confirmed. A chunk Drive kept none of counts as a failure; a
   * position outside the bytes sent is a protocol error.
   */
  private async advance(
    progress: SessionProgress,
    committed: number,
    chunkSent: boolean,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { offset, sent, total } = progress;

    if (committed < offset || committed > sent || (total !== undefined && committed >= total)) {
      throw new IntegrationError(
        'INTEGRATION_UNCLASSIFIED',
        'Drive reported an upload position that does not match the bytes sent',
      );
    }

    if (committed > offset) {
      progress.failures = 0;
    } else if (chunkSent) {
      progress.failures += 1;
      await this.backOff(
        new IntegrationError('DRIVE_UNAVAILABLE', 'Drive kept none of the uploaded bytes'),
        progress.failures,
        signal,
      );
    }

    progress.offset = committed;
    progress.askStatus = false;
  }

  /** Sends the source through one session: the file ID, or `expired`. */
  private async sendAll(
    sessionUrl: URL,
    source: UploadSource,
    signal: AbortSignal | undefined,
  ): Promise<'expired' | { fileId: string }> {
    const progress: SessionProgress = {
      askStatus: false,
      failures: 0,
      offset: 0,
      sent: 0,
      total: source.size,
    };

    for (;;) {
      const chunkSent = !progress.askStatus;
      const outcome = await this.sendNext(sessionUrl, source, progress, signal);

      switch (outcome.kind) {
        case 'complete': {
          return { fileId: outcome.fileId };
        }

        case 'expired': {
          return 'expired';
        }

        case 'failed': {
          progress.failures += 1;
          await this.backOff(outcome.error, progress.failures, signal);
          progress.askStatus = true;
          break;
        }

        case 'incomplete': {
          await this.advance(progress, outcome.committed, chunkSent, signal);
          source.release(progress.offset);
          break;
        }
      }
    }
  }

  /** Sends the next chunk from Drive's offset, or after a failure, asks for that offset. */
  private async sendNext(
    sessionUrl: URL,
    source: UploadSource,
    progress: SessionProgress,
    signal: AbortSignal | undefined,
  ): Promise<ChunkOutcome> {
    if (progress.askStatus) {
      return this.put(sessionUrl, `bytes */${progress.total ?? '*'}`, undefined, signal);
    }

    const { offset } = progress;
    // A stream may stall indefinitely; the abort must not wait for it.
    const chunk = await abortable(source.read(offset, this.chunkSize), signal);
    const chunkEnd = offset + chunk.bytes.length;

    if (chunk.end) {
      progress.total = chunkEnd;
    }

    progress.sent = Math.max(progress.sent, chunkEnd);

    const total = progress.total ?? '*';
    const range =
      chunk.bytes.length === 0 ? `bytes */${total}` : `bytes ${offset}-${chunkEnd - 1}/${total}`;

    return this.put(sessionUrl, range, chunk.bytes, signal);
  }

  /** Opens an upload session. Nothing exists in Drive yet, so a failed start is retried. */
  private async startSession(
    metadata: DriveUploadMetadata,
    size: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<URL> {
    const url = new URL(DRIVE_UPLOAD_URL);

    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('uploadType', 'resumable');

    const init = {
      body: JSON.stringify(metadata),
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': metadata.mimeType,
        ...(size === undefined ? {} : { 'X-Upload-Content-Length': String(size) }),
      },
      method: 'POST',
    };

    for (let failures = 1; ; failures += 1) {
      const result = await this.exchange(url, init, signal);

      if (result instanceof Response && result.status === 200) {
        const location = result.headers.get('location');

        await result.body?.cancel();

        return sessionUrlOf(location);
      }

      const error =
        result instanceof Response ? await googleApiErrorOf('drive', result, signal) : result;

      if (!isServiceUnavailable(error, 'drive')) {
        throw error;
      }

      await this.backOff(error, failures, signal);
    }
  }
}

/** `Range: bytes=0-N` → N + 1 bytes are in Drive; no header → none. */
function committedBytes(range: null | string): number {
  if (range === null) {
    return 0;
  }

  const match = committedRangePattern.exec(range.trim());

  if (match === null) {
    throw new IntegrationError(
      'INTEGRATION_UNCLASSIFIED',
      'Drive returned an unreadable Range header',
    );
  }

  return Number(match[1]) + 1;
}

/** The session URL must be Drive's upload endpoint: it receives the bearer token. */
function sessionUrlOf(location: null | string): URL {
  let url: URL | undefined;

  try {
    url = location === null ? undefined : new URL(location);
  } catch {
    url = undefined;
  }

  if (
    url?.protocol !== 'https:' ||
    url.origin !== uploadOrigin.origin ||
    url.pathname !== uploadOrigin.pathname ||
    !url.searchParams.has('upload_id')
  ) {
    throw new IntegrationError(
      'INTEGRATION_UNCLASSIFIED',
      'Drive returned an unexpected upload session URL',
    );
  }

  return url;
}

/**
 * The new file's ID from the reply to the last chunk, or why the reply names none: it was cut
 * off (`DRIVE_UNAVAILABLE`), or it is not a file (`INTEGRATION_UNCLASSIFIED`). Either way the
 * caller asks the session again, and fails with this error only when no attempt is left.
 */
async function uploadedFileId(response: Response): Promise<IntegrationError | string> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return new IntegrationError('DRIVE_UNAVAILABLE', "Drive's reply to the last chunk was cut off");
  }

  const parsed = uploadedFileSchema.safeParse(body);

  return parsed.success
    ? parsed.data.id
    : new IntegrationError(
        'INTEGRATION_UNCLASSIFIED',
        `Drive returned an unexpected response (HTTP ${response.status}) to the last chunk`,
      );
}
