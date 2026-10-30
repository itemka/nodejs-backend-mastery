import { open } from 'node:fs/promises';
import { z } from 'zod';

import { IntegrationError } from '../../application/integration-error.js';
import type { GoogleTokenProvider } from '../../application/ports.js';
import { abortable } from '../../shared/abortable.js';
import {
  backoffMs,
  MAX_IN_TICK_DELAY_SEC,
  retryTransient,
  TransientFailure,
} from '../../shared/retry.js';
import type { Sleep } from '../../shared/sleep.js';
import { pause, systemSleep } from '../../shared/sleep.js';
import type { GoogleApiError } from '../google/google-api-client.js';
import {
  googleApiErrorOf,
  isServiceUnavailable,
  serviceAccessToken,
  serviceUnavailable,
} from '../google/google-api-client.js';
import { DRIVE_UPLOAD_URL, driveIdSchema } from './drive-schemas.js';

/** Drive takes chunks in multiples of 256 KiB; only the last chunk may be shorter. */
export const UPLOAD_CHUNK_UNIT = 256 * 1024;
export const DEFAULT_UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;

/**
 * The bytes of one upload, readable from any offset: the uploader reads again from the offset
 * Drive last confirmed, and a new session after an expired one reads again from offset 0.
 */
export interface UploadSource {
  readonly size: number;
  /** Up to `length` bytes from `offset`; fewer only at the end. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Bytes in memory, such as the `.sha256` sidecar. */
export function bytesSource(bytes: Uint8Array): UploadSource {
  return {
    read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
    size: bytes.length,
  };
}

export interface FileUploadSource extends UploadSource {
  close(): Promise<void>;
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

        return buffer;
      },
      size,
    };
  } catch (error) {
    await handle.close();

    throw error;
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
  readonly total: number;
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
 * - `404` or `410`: the session expired; a new session sends the source again from offset 0.
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

    if (committed < offset || committed > sent || committed >= total) {
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
    const { offset, total } = progress;

    if (progress.askStatus) {
      return this.put(sessionUrl, `bytes */${total}`, undefined, signal);
    }

    // A read may stall; the abort must not wait for it.
    const bytes = await abortable(source.read(offset, this.chunkSize), signal);
    const chunkEnd = offset + bytes.length;

    progress.sent = Math.max(progress.sent, chunkEnd);

    const range =
      bytes.length === 0 ? `bytes */${total}` : `bytes ${offset}-${chunkEnd - 1}/${total}`;

    return this.put(sessionUrl, range, bytes, signal);
  }

  /** Opens an upload session. Nothing exists in Drive yet, so a failed start is retried. */
  private async startSession(
    metadata: DriveUploadMetadata,
    size: number,
    signal: AbortSignal | undefined,
  ): Promise<URL> {
    const url = new URL(DRIVE_UPLOAD_URL);

    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('uploadType', 'resumable');

    const init = {
      body: JSON.stringify(metadata),
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': metadata.mimeType,
      },
      method: 'POST',
    };

    return retryTransient(
      async () => {
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

        return new TransientFailure(error);
      },
      { attempts: this.maxAttempts, signal, sleep: this.sleep },
    );
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
