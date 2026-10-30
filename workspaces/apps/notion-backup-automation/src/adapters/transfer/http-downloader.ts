import type { FileHandle } from 'node:fs/promises';
import { open, rename, rm, statfs } from 'node:fs/promises';
import path from 'node:path';

import { IntegrationError } from '../../application/integration-error.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import type { Digests } from '../../shared/digests.js';
import { Digester } from '../../shared/digests.js';
import type { Logger } from '../../shared/logger.js';
import { parseRetryAfter, retryTransient, TransientFailure } from '../../shared/retry.js';
import { SecretValue } from '../../shared/secret-value.js';
import type { Sleep } from '../../shared/sleep.js';
import { systemSleep } from '../../shared/sleep.js';
import { isAllowedDownloadLink } from '../gmail/export-email-parser.js';

/**
 * Notion's signed export file, as observed in Phase 0:
 * `https://file.notion.com/f/t/<uuid>/Export-<uuid>.zip?table=user_export&expirationTimestamp=…`.
 */
export const NOTION_FILE = {
  /** Milliseconds since the epoch; the signature expires then (7 days after the export). */
  expiryParam: 'expirationTimestamp',
  host: 'file.notion.com',
  pathPrefix: '/f/',
  table: 'user_export',
} as const;

/** Where the email's link leads: Notion's signed file URL, and when its signature expires. */
export interface DownloadTarget {
  readonly expiresAt: Date;
  /** Signed: never stored, logged or returned. */
  readonly url: SecretValue<URL>;
}

export interface DownloadRequest {
  /** Sent to Notion's file host only. */
  readonly cookieHeader: SecretValue<string>;
  /** Where the ZIP is written; it is `<path>.part` until its length is checked. */
  readonly path: string;
  readonly signal?: AbortSignal | undefined;
  readonly target: DownloadTarget;
}

/** `link_expired`: the file host refused the link after its `expirationTimestamp`. */
export type DownloadResult =
  | { readonly digests: Digests; readonly outcome: 'downloaded' }
  | { readonly outcome: 'link_expired' };

export interface HttpDownloaderOptions {
  clock?: Clock;
  fetch?: typeof fetch;
  /** Free bytes in a directory; `statfs` by default. */
  freeSpace?: (directory: string) => Promise<number>;
  /** An attempt fails when no byte arrives for this long. */
  idleTimeoutMs?: number;
  /** The Mailgun hop, which answers with a redirect only. */
  linkTimeoutMs?: number;
  /** Logs attempt failures with codes and statuses only: never a URL or cookie. */
  logger: Logger;
  /** Attempts per call for network errors, timeouts, 429 and 5xx. */
  maxAttempts?: number;
  /** Space left free in the directory besides the ZIP. */
  reserveBytes?: number;
  sleep?: Sleep;
}

/** Redirect statuses; `fetch` with `redirect: 'manual'` returns them as they are. */
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const FILE_HOST = "Notion's file host";

/**
 * The HTTP side of the transfer. `resolve` follows the email's Mailgun link one hop, without
 * cookies, to Notion's signed file URL. `download` fetches that URL with the session cookies and
 * streams the ZIP to disk, hashing it on the way. Neither follows any other redirect, so the
 * cookies reach `file.notion.com` only.
 */
export class HttpDownloader {
  private readonly clock: Clock;
  private readonly fetch: typeof fetch;
  private readonly freeSpace: (directory: string) => Promise<number>;
  private readonly idleTimeoutMs: number;
  private readonly linkTimeoutMs: number;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly reserveBytes: number;
  private readonly sleep: Sleep;

  constructor({
    clock = systemClock,
    fetch = globalThis.fetch,
    freeSpace = freeBytes,
    idleTimeoutMs = 30_000,
    linkTimeoutMs = 15_000,
    logger,
    maxAttempts = 3,
    reserveBytes = 16 * 1024 * 1024,
    sleep = systemSleep,
  }: HttpDownloaderOptions) {
    this.clock = clock;
    this.fetch = fetch;
    this.freeSpace = freeSpace;
    this.idleTimeoutMs = idleTimeoutMs;
    this.linkTimeoutMs = linkTimeoutMs;
    this.logger = logger;
    this.maxAttempts = maxAttempts;
    this.reserveBytes = reserveBytes;
    this.sleep = sleep;
  }

  /**
   * Downloads the ZIP to `request.path`, checking its length against `Content-Length` and the
   * free space. Only a complete download is renamed into place; `<path>.part` never remains.
   */
  async download(request: DownloadRequest): Promise<DownloadResult> {
    const partPath = `${request.path}.part`;

    try {
      const result = await this.withAttempts(request.signal, () =>
        this.downloadOnce(request, partPath),
      );

      if (result.outcome === 'downloaded') {
        await rename(partPath, request.path);
      }

      return result;
    } finally {
      await rm(partPath, { force: true });
    }
  }

  /**
   * Follows the email's link to Notion's signed file URL. A link outside the allowlist, a
   * redirect elsewhere, or a file URL without its expiry is `EMAIL_UNRECOGNIZED`.
   */
  async resolve(link: SecretValue<string>, signal?: AbortSignal): Promise<DownloadTarget> {
    const href = link.reveal();

    if (!isAllowedDownloadLink(href)) {
      throw new IntegrationError('EMAIL_UNRECOGNIZED', 'The download link is not a Mailgun link');
    }

    return this.withAttempts(signal, () => this.followLink(new URL(href), signal));
  }

  private async downloadOnce(
    { cookieHeader, signal, target }: DownloadRequest,
    partPath: string,
  ): Promise<DownloadResult> {
    // Every attempt starts at byte 0. A failed attempt's partial file still takes disk space,
    // which the free-space check below would count against this attempt.
    await rm(partPath, { force: true });

    const idle = new IdleTimer(this.idleTimeoutMs);
    const attemptSignal =
      signal === undefined ? idle.signal : AbortSignal.any([signal, idle.signal]);

    try {
      let response: Response;

      try {
        response = await this.fetch(target.url.reveal(), {
          headers: { 'Accept-Encoding': 'identity', Cookie: cookieHeader.reveal() },
          redirect: 'manual',
          signal: attemptSignal,
        });
      } catch {
        signal?.throwIfAborted();

        throw downloadFailed(`${FILE_HOST} did not respond`);
      }

      if (response.status !== 200 || response.body === null) {
        await cancelBody(response);

        return this.refusal(response, target);
      }

      const expectedBytes = contentLength(response);
      const limitBytes = (await this.freeSpace(path.dirname(partPath))) - this.reserveBytes;

      if (expectedBytes !== undefined && expectedBytes > limitBytes) {
        await cancelBody(response);

        throw tmpSpaceInsufficient(expectedBytes, limitBytes);
      }

      const digests = await writeBody(response.body, partPath, {
        expectedBytes,
        idle,
        limitBytes,
        signal,
      });

      if (expectedBytes !== undefined && digests.sizeBytes !== expectedBytes) {
        throw downloadFailed(
          `The download ended after ${digests.sizeBytes} of ${expectedBytes} bytes`,
        );
      }

      return { digests, outcome: 'downloaded' };
    } finally {
      idle.stop();
    }
  }

  private async followLink(link: URL, signal: AbortSignal | undefined): Promise<DownloadTarget> {
    const timeout = AbortSignal.timeout(this.linkTimeoutMs);
    let response: Response;

    try {
      response = await this.fetch(link, {
        redirect: 'manual',
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch {
      signal?.throwIfAborted();

      throw downloadFailed('The download link did not respond');
    }

    await cancelBody(response);

    if (redirectStatuses.has(response.status)) {
      const target = fileTargetOf(response.headers.get('location'), link);

      if (target === undefined) {
        throw new IntegrationError(
          'EMAIL_UNRECOGNIZED',
          "The download link did not redirect to Notion's export file",
        );
      }

      return target;
    }

    if (isTransientStatus(response.status)) {
      throw downloadFailed(`The download link returned HTTP ${response.status}`, response);
    }

    if (response.ok) {
      throw new IntegrationError(
        'EMAIL_UNRECOGNIZED',
        `The download link returned HTTP ${response.status} instead of a redirect`,
      );
    }

    throw new IntegrationError(
      'INTEGRATION_UNCLASSIFIED',
      `The download link returned HTTP ${response.status}`,
    );
  }

  /** A response other than the ZIP. A refusal after the link's expiry means the link expired. */
  private refusal(response: Response, target: DownloadTarget): DownloadResult {
    const { status } = response;

    if (status === 401 || status === 403) {
      if (this.clock.now().getTime() >= target.expiresAt.getTime()) {
        return { outcome: 'link_expired' };
      }

      throw new IntegrationError(
        'NOTION_SESSION_EXPIRED',
        `${FILE_HOST} refused the saved session (HTTP ${status})`,
      );
    }

    if (isTransientStatus(status)) {
      throw downloadFailed(`${FILE_HOST} returned HTTP ${status}`, response);
    }

    const detail = redirectStatuses.has(status)
      ? `${FILE_HOST} redirected (HTTP ${status}); only a direct download is allowed`
      : `${FILE_HOST} returned HTTP ${status}`;

    throw new IntegrationError('INTEGRATION_UNCLASSIFIED', detail);
  }

  /**
   * Runs `attempt` again after a `DOWNLOAD_FAILED` that is worth retrying now: a network error,
   * a timeout, a short download, 429 or 5xx with a `Retry-After` of at most 10 s.
   */
  private withAttempts<T>(signal: AbortSignal | undefined, attempt: () => Promise<T>): Promise<T> {
    return retryTransient(
      async () => {
        try {
          return await attempt();
        } catch (error) {
          if (error instanceof IntegrationError && error.code === 'DOWNLOAD_FAILED') {
            return new TransientFailure(error);
          }

          throw error;
        }
      },
      {
        attempts: this.maxAttempts,
        onRetry: (error, attemptNumber) => {
          this.logger.warn('transfer.download.retry', {
            attempt: attemptNumber,
            reason: error.message,
          });
        },
        signal,
        sleep: this.sleep,
      },
    );
  }
}

/** Aborts its signal with `error` when `touch` has not been called for `timeoutMs`. */
class IdleTimer {
  readonly error: IntegrationError;
  readonly signal: AbortSignal;
  readonly #controller = new AbortController();
  readonly #timer: NodeJS.Timeout;

  constructor(timeoutMs: number) {
    this.error = downloadFailed(`No data arrived for ${timeoutMs} ms`);
    this.signal = this.#controller.signal;
    this.#timer = setTimeout(() => {
      this.#controller.abort(this.error);
    }, timeoutMs);
  }

  get expired(): boolean {
    return this.signal.aborted;
  }

  stop(): void {
    clearTimeout(this.#timer);
  }

  touch(): void {
    this.#timer.refresh();
  }
}

interface WriteLimits {
  readonly expectedBytes: number | undefined;
  readonly idle: IdleTimer;
  /** Free space for the file. */
  readonly limitBytes: number;
  readonly signal: AbortSignal | undefined;
}

/** Streams the body to a new file (0600), hashing it; stops at the first byte too many. */
async function writeBody(
  body: ReadableStream<Uint8Array>,
  file: string,
  { expectedBytes, idle, limitBytes, signal }: WriteLimits,
): Promise<Digests> {
  const digester = new Digester();
  let received = 0;
  let handle: FileHandle | undefined;

  try {
    handle = await open(file, 'w', 0o600);

    // `fetch` ties the body to the attempt's signal, so an abort or a stall ends this loop.
    for await (const chunk of body) {
      idle.touch();
      received += chunk.length;

      if (received > limitBytes) {
        throw tmpSpaceInsufficient(received, limitBytes);
      }

      if (expectedBytes !== undefined && received > expectedBytes) {
        throw new IntegrationError(
          'INTEGRATION_UNCLASSIFIED',
          `${FILE_HOST} sent more bytes than its Content-Length`,
        );
      }

      digester.update(chunk);
      // On an open handle, `writeFile` writes every byte at the current position.
      await handle.writeFile(chunk);
    }
  } catch (error) {
    signal?.throwIfAborted();

    if (error instanceof IntegrationError) {
      throw error;
    }

    if (idle.expired) {
      throw idle.error;
    }

    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
      throw tmpSpaceInsufficient(received, limitBytes);
    }

    if (handle === undefined) {
      throw error;
    }

    throw downloadFailed('The download was interrupted');
  } finally {
    await handle?.close();
  }

  return digester.digest();
}

/** Notion's signed file URL from a redirect, or undefined when it is anything else. */
function fileTargetOf(location: null | string, base: URL): DownloadTarget | undefined {
  if (location === null) {
    return undefined;
  }

  let url: URL;

  try {
    url = new URL(location, base);
  } catch {
    return undefined;
  }

  const expiry = url.searchParams.get(NOTION_FILE.expiryParam) ?? '';
  // A 16-digit value can still exceed 8.64e15 ms, the latest time a Date holds: it would parse to
  // an invalid Date, which every expiry comparison treats as "not expired".
  const expiresAt = /^\d{1,16}$/.test(expiry) ? new Date(Number(expiry)) : undefined;

  if (
    url.protocol !== 'https:' ||
    url.hostname !== NOTION_FILE.host ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(NOTION_FILE.pathPrefix) ||
    url.searchParams.get('table') !== NOTION_FILE.table ||
    expiresAt === undefined ||
    Number.isNaN(expiresAt.getTime())
  ) {
    return undefined;
  }

  return { expiresAt, url: new SecretValue(url) };
}

/** The body's length when the server states it and sends the bytes unencoded. */
function contentLength(response: Response): number | undefined {
  const encoding = response.headers.get('content-encoding');
  const length = response.headers.get('content-length');

  if ((encoding !== null && encoding !== 'identity') || length === null || !/^\d+$/.test(length)) {
    return undefined;
  }

  return Number(length);
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is unused; a failure to discard it changes nothing.
  }
}

async function freeBytes(directory: string): Promise<number> {
  const { bavail, bsize } = await statfs(directory);

  return bavail * bsize;
}

function downloadFailed(detail: string, response?: Response): IntegrationError {
  const retryAfterSec =
    response === undefined
      ? undefined
      : parseRetryAfter(response.headers.get('retry-after'), Date.now());

  return new IntegrationError(
    'DOWNLOAD_FAILED',
    detail,
    retryAfterSec === undefined ? {} : { retryAfterSec },
  );
}

function tmpSpaceInsufficient(neededBytes: number, limitBytes: number): IntegrationError {
  return new IntegrationError(
    'TMP_SPACE_INSUFFICIENT',
    `The ZIP needs at least ${neededBytes} bytes; ${Math.max(0, limitBytes)} are free`,
  );
}
