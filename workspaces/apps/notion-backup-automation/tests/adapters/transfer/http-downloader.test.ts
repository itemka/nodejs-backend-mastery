import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

import type {
  DownloadTarget,
  HttpDownloaderOptions,
} from '../../../src/adapters/transfer/http-downloader.js';
import { HttpDownloader } from '../../../src/adapters/transfer/http-downloader.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import { digestsOf } from '../../../src/shared/digests.js';
import { createLogger } from '../../../src/shared/logger.js';
import { SecretValue } from '../../../src/shared/secret-value.js';
import { ManualClock } from '../../support/manual-clock.js';
import {
  accessDenied,
  dropAfter,
  FILE_HOST,
  fileUrl,
  MAILGUN_HOST,
  MAILGUN_LINK,
  NotionHosts,
  redirectTo,
  serveBytes,
  stallAfter,
} from '../../support/notion-hosts.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const EXPIRES = new Date(NOW.getTime() + 7 * 24 * 3600 * 1000);
const COOKIE = `file_token=${'f'.repeat(40)}`;
const MIB = 1024 * 1024;
const ZIP = randomBytes(600_000);

async function setup(options: Partial<HttpDownloaderOptions> = {}) {
  const hosts = await NotionHosts.start();
  const clock = new ManualClock(NOW);
  const sleeps: number[] = [];
  const logs: string[] = [];
  const directory = await mkdtemp(path.join(tmpdir(), 'nba-download-'));

  onTestFinished(() => rm(directory, { force: true, recursive: true }));

  const downloader = new HttpDownloader({
    clock,
    fetch: hosts.fetch,
    freeSpace: () => Promise.resolve(1024 * MIB),
    logger: createLogger({
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    sleep: (ms) => {
      sleeps.push(ms);

      return Promise.resolve();
    },
    ...options,
  });

  return { clock, directory, downloader, hosts, logs, sleeps };
}

function target(expiresAt = EXPIRES): DownloadTarget {
  return { expiresAt, url: new SecretValue(new URL(fileUrl(expiresAt))) };
}

function request(directory: string, signal?: AbortSignal) {
  return {
    cookieHeader: new SecretValue(COOKIE),
    path: path.join(directory, '2026-10.zip'),
    signal,
    target: target(),
  };
}

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(IntegrationError);
  // Neither URL ever reaches an error message.
  expect((error as Error).message).not.toMatch(/signature|mg\.mail|\/c\/|\/f\/t\//);

  return error as IntegrationError;
}

describe('HttpDownloader.resolve', () => {
  it("follows the Mailgun hop, without cookies, to Notion's signed file URL", async () => {
    const { downloader, hosts } = await setup();

    hosts.on(MAILGUN_HOST, redirectTo(fileUrl(EXPIRES)));

    const resolved = await downloader.resolve(new SecretValue(MAILGUN_LINK));

    expect(resolved.expiresAt).toEqual(EXPIRES);
    expect(resolved.url.reveal().href).toBe(fileUrl(EXPIRES));
    expect(hosts.requests).toHaveLength(1);
    expect(hosts.requests[0]).toMatchObject({ cookie: undefined, host: MAILGUN_HOST });
    // The signed URL stays hidden when the target is logged or serialized.
    expect(JSON.stringify(resolved)).not.toContain('signature');
  });

  it('refuses a link outside the Mailgun allowlist without a request', async () => {
    const { downloader, hosts } = await setup();

    const error = await rejection(downloader.resolve(new SecretValue(fileUrl(EXPIRES))));

    expect(error.code).toBe('EMAIL_UNRECOGNIZED');
    expect(hosts.requests).toHaveLength(0);
  });

  it.each([
    [
      'another host',
      'https://files.example.com/f/t/x/Export.zip?table=user_export&expirationTimestamp=1',
    ],
    ['plain HTTP', fileUrl(EXPIRES).replace('https:', 'http:')],
    ['a port', fileUrl(EXPIRES).replace(FILE_HOST, `${FILE_HOST}:8443`)],
    ['credentials', fileUrl(EXPIRES).replace(FILE_HOST, `user:pw@${FILE_HOST}`)],
    ['another path', fileUrl(EXPIRES).replace('/f/t/', '/api/t/')],
    ['another table', fileUrl(EXPIRES, { table: 'block' })],
    ['no expiry', fileUrl(EXPIRES).replace(/expirationTimestamp=\d+&?/, '')],
    ['an unreadable expiry', fileUrl(EXPIRES, { expirationTimestamp: 'soon' })],
  ])('treats a redirect to %s as EMAIL_UNRECOGNIZED', async (_case, location) => {
    const { downloader, hosts } = await setup();

    hosts.on(MAILGUN_HOST, redirectTo(location));

    const error = await rejection(downloader.resolve(new SecretValue(MAILGUN_LINK)));

    expect(error.code).toBe('EMAIL_UNRECOGNIZED');
    expect(hosts.requests).toHaveLength(1);
  });

  it('treats a redirect without a Location as EMAIL_UNRECOGNIZED', async () => {
    const { downloader, hosts } = await setup();

    hosts.on(MAILGUN_HOST, (_request, response) => {
      response.writeHead(302).end();
    });

    const error = await rejection(downloader.resolve(new SecretValue(MAILGUN_LINK)));

    expect(error.code).toBe('EMAIL_UNRECOGNIZED');
  });

  it('treats a page instead of a redirect as EMAIL_UNRECOGNIZED', async () => {
    const { downloader, hosts } = await setup();

    hosts.on(MAILGUN_HOST, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>');
    });

    const error = await rejection(downloader.resolve(new SecretValue(MAILGUN_LINK)));

    expect(error.code).toBe('EMAIL_UNRECOGNIZED');
  });

  it('retries 503 replies with backoff, then follows the redirect', async () => {
    const { downloader, hosts, sleeps } = await setup();
    let calls = 0;

    hosts.on(MAILGUN_HOST, (request, response) => {
      calls += 1;

      if (calls < 3) {
        response.writeHead(503).end();

        return;
      }

      redirectTo(fileUrl(EXPIRES))(request, response);
    });

    await expect(downloader.resolve(new SecretValue(MAILGUN_LINK))).resolves.toMatchObject({
      expiresAt: EXPIRES,
    });
    expect(sleeps).toEqual([500, 1000]);
  });

  it('reports a link that never answers as DOWNLOAD_FAILED after 3 attempts', async () => {
    const { downloader, hosts } = await setup();

    hosts.on(MAILGUN_HOST, (_request, response) => {
      response.socket?.destroy();
    });

    const error = await rejection(downloader.resolve(new SecretValue(MAILGUN_LINK)));

    expect(error.code).toBe('DOWNLOAD_FAILED');
    expect(hosts.requests).toHaveLength(3);
  });

  it('does not retry an unclassified status', async () => {
    const { downloader, hosts } = await setup();

    hosts.on(MAILGUN_HOST, (_request, response) => {
      response.writeHead(404).end();
    });

    const error = await rejection(downloader.resolve(new SecretValue(MAILGUN_LINK)));

    expect(error).toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: 'The download link returned HTTP 404',
    });
    expect(hosts.requests).toHaveLength(1);
  });
});

describe('HttpDownloader.download', () => {
  it('writes the ZIP with its digests, sending only the session cookie', async () => {
    const { directory, downloader, hosts } = await setup();

    hosts.on(FILE_HOST, serveBytes(ZIP));

    const result = await downloader.download(request(directory));

    expect(result).toEqual({ digests: digestsOf(ZIP), outcome: 'downloaded' });
    expect(await readFile(path.join(directory, '2026-10.zip'))).toEqual(ZIP);
    const { mode } = await stat(path.join(directory, '2026-10.zip'));

    expect(mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['2026-10.zip']);
    expect(hosts.requests).toHaveLength(1);
    expect(hosts.requests[0]).toMatchObject({
      cookie: COOKIE,
      host: FILE_HOST,
      path: '/f/t/00000000-0000-4000-8000-000000000002/Export-00000000-0000-4000-8000-000000000001.zip',
    });
    expect(hosts.requests[0]?.headers['accept-encoding']).toBe('identity');
  });

  it('treats a 403 before the expiry as NOTION_SESSION_EXPIRED', async () => {
    const { directory, downloader, hosts } = await setup();

    hosts.on(FILE_HOST, accessDenied);

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
      message: "Notion's file host refused the saved session (HTTP 403)",
    });
    expect(hosts.requests).toHaveLength(1);
    expect(await readdir(directory)).toEqual([]);
  });

  it('treats a 403 once the expiry has passed as an expired link', async () => {
    const { clock, directory, downloader, hosts } = await setup();

    hosts.on(FILE_HOST, (request_, response) => {
      clock.advance(EXPIRES.getTime() - NOW.getTime());
      accessDenied(request_, response);
    });

    await expect(downloader.download(request(directory))).resolves.toEqual({
      outcome: 'link_expired',
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it('retries a body cut short of its Content-Length, from the start', async () => {
    const { directory, downloader, hosts, logs, sleeps } = await setup();
    let calls = 0;

    hosts.on(FILE_HOST, (request_, response) => {
      calls += 1;
      (calls === 1 ? dropAfter(ZIP, 100_000) : serveBytes(ZIP))(request_, response);
    });

    await expect(downloader.download(request(directory))).resolves.toEqual({
      digests: digestsOf(ZIP),
      outcome: 'downloaded',
    });
    expect(sleeps).toEqual([500]);
    expect(logs.join('\n')).toContain('transfer.download.retry');
    expect(logs.join('\n')).not.toMatch(/file_token|signature/);
  });

  it('reports DOWNLOAD_FAILED after 3 server errors, waiting out a short Retry-After', async () => {
    const { directory, downloader, hosts, sleeps } = await setup();

    hosts.on(FILE_HOST, (_request, response) => {
      response.writeHead(503, { 'Retry-After': '2' }).end();
    });

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({ code: 'DOWNLOAD_FAILED', retryAfterSec: 2 });
    expect(sleeps).toEqual([2000, 2000]);
    expect(hosts.requests).toHaveLength(3);
    expect(await readdir(directory)).toEqual([]);
  });

  it('passes a long Retry-After on instead of waiting', async () => {
    const { directory, downloader, hosts, sleeps } = await setup();

    hosts.on(FILE_HOST, (_request, response) => {
      response.writeHead(429, { 'Retry-After': '60' }).end();
    });

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({ code: 'DOWNLOAD_FAILED', retryAfterSec: 60 });
    expect(sleeps).toEqual([]);
    expect(hosts.requests).toHaveLength(1);
  });

  it('never follows a redirect from the file host, so the cookies go nowhere else', async () => {
    const { directory, downloader, hosts } = await setup();

    hosts.on(FILE_HOST, redirectTo('https://elsewhere.example.com/Export.zip'));

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: "Notion's file host redirected (HTTP 302); only a direct download is allowed",
    });
    expect(hosts.requests.map((item) => item.host)).toEqual([FILE_HOST]);
  });

  it('refuses a ZIP larger than the free space before writing it', async () => {
    const { directory, downloader, hosts } = await setup({
      freeSpace: () => Promise.resolve(16 * MIB + 100_000),
    });

    hosts.on(FILE_HOST, serveBytes(ZIP));

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({
      code: 'TMP_SPACE_INSUFFICIENT',
      message: 'The ZIP needs at least 600000 bytes; 100000 are free',
    });
    expect(hosts.requests).toHaveLength(1);
    expect(await readdir(directory)).toEqual([]);
  });

  it('stops a body of unknown length once it outgrows the free space', async () => {
    const { directory, downloader, hosts } = await setup({
      freeSpace: () => Promise.resolve(16 * MIB + 100_000),
    });

    hosts.on(FILE_HOST, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/zip' }).end(ZIP);
    });

    const error = await rejection(downloader.download(request(directory)));

    expect(error.code).toBe('TMP_SPACE_INSUFFICIENT');
    expect(await readdir(directory)).toEqual([]);
  });

  it('fails a body that ends short of its Content-Length', async () => {
    const { directory, downloader } = await setup({
      // A clean end with too few bytes; over a socket, `fetch` itself reports the cut first.
      fetch: () =>
        Promise.resolve(
          new Response(ZIP.subarray(0, 1000), {
            headers: { 'Content-Length': String(ZIP.length) },
          }),
        ),
    });

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({
      code: 'DOWNLOAD_FAILED',
      message: 'The download ended after 1000 of 600000 bytes',
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it('keeps a slow download that still makes progress', async () => {
    const { directory, downloader, hosts } = await setup({ idleTimeoutMs: 150, maxAttempts: 1 });
    const pieces = 8;
    const pieceBytes = ZIP.length / pieces;

    hosts.on(FILE_HOST, (_request, response) => {
      response.writeHead(200, { 'Content-Length': String(ZIP.length) });

      // Every piece comes well within the idle timeout; all of them together take longer.
      for (let piece = 0; piece < pieces; piece += 1) {
        setTimeout(() => {
          const start = piece * pieceBytes;

          response.write(ZIP.subarray(start, start + pieceBytes));

          if (piece === pieces - 1) {
            response.end();
          }
        }, piece * 40);
      }
    });

    await expect(downloader.download(request(directory))).resolves.toEqual({
      digests: digestsOf(ZIP),
      outcome: 'downloaded',
    });
  });

  it('fails a stalled download after the idle timeout', async () => {
    const { directory, downloader, hosts } = await setup({ idleTimeoutMs: 50, maxAttempts: 1 });

    hosts.on(FILE_HOST, stallAfter(ZIP, 1000));

    const error = await rejection(downloader.download(request(directory)));

    expect(error).toMatchObject({ code: 'DOWNLOAD_FAILED', message: 'No data arrived for 50 ms' });
    expect(await readdir(directory)).toEqual([]);
  });

  it('stops with the reason of an abort during the body, leaving no file', async () => {
    // One attempt: the abort must surface as its reason, not as a failed last attempt.
    const { directory, downloader, hosts } = await setup({ maxAttempts: 1 });
    const controller = new AbortController();
    const reason = new Error('transfer budget');

    hosts.on(
      FILE_HOST,
      stallAfter(ZIP, 1000, () => {
        controller.abort(reason);
      }),
    );

    await expect(downloader.download(request(directory, controller.signal))).rejects.toBe(reason);
    expect(await readdir(directory)).toEqual([]);
  });
});
