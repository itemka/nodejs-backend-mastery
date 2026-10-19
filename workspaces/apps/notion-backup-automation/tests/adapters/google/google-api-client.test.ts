import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { GoogleService } from '../../../src/adapters/google/google-api-client.js';
import {
  GoogleApiClient,
  GoogleApiError,
  parseRetryAfter,
} from '../../../src/adapters/google/google-api-client.js';
import { GoogleTokenUnavailableError } from '../../../src/adapters/google/token-provider.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import { FakeGoogle, googleError } from '../../support/fake-google.js';

const URL_PATH = 'www.googleapis.com/drive/v3/files/root-id';
const URL = `https://${URL_PATH}`;
const fileSchema = z.object({ id: z.string() });

function setup(
  options: { service?: GoogleService; tokenProvider?: { getAccessToken(): Promise<string> } } = {},
) {
  const google = new FakeGoogle();
  const sleeps: number[] = [];
  const client = new GoogleApiClient({
    fetch: google.fetch,
    service: options.service ?? 'drive',
    sleep: (ms) => {
      sleeps.push(ms);

      return Promise.resolve();
    },
    tokenProvider: options.tokenProvider ?? {
      getAccessToken: () => Promise.resolve('fake-access-token'),
    },
  });

  return { client, google, sleeps };
}

async function failure(promise: Promise<unknown>): Promise<GoogleApiError> {
  const error = await promise.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(GoogleApiError);

  return error as GoogleApiError;
}

describe('GoogleApiClient', () => {
  it('sends the bearer token and query, and parses the reply', async () => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () => Response.json({ id: 'root-id', ignored: true }));

    await expect(
      client.json(fileSchema, {
        query: { fields: 'id', skipped: undefined, supportsAllDrives: true },
        url: URL,
      }),
    ).resolves.toEqual({ id: 'root-id' });

    const [request] = google.requests;

    expect(request?.headers.get('authorization')).toBe('Bearer fake-access-token');
    expect(request?.url.search).toBe('?fields=id&supportsAllDrives=true');
  });

  it('sends a JSON body', async () => {
    const { client, google } = setup();

    google.on('POST', 'www.googleapis.com/drive/v3/files', () => Response.json({ id: 'new' }));

    await client.json(fileSchema, {
      body: { name: 'probe' },
      method: 'POST',
      url: 'https://www.googleapis.com/drive/v3/files',
    });

    expect(google.requests[0]?.headers.get('content-type')).toBe('application/json');
    expect(google.requests[0]?.body).toBe('{"name":"probe"}');
  });

  it('retries a GET after a 503 and succeeds', async () => {
    const { client, google, sleeps } = setup();
    let calls = 0;

    google.on('GET', URL_PATH, () => {
      calls += 1;

      return calls === 1 ? googleError(503) : Response.json({ id: 'root-id' });
    });

    await expect(client.json(fileSchema, { url: URL })).resolves.toEqual({ id: 'root-id' });
    expect(sleeps).toEqual([500]);
  });

  it('honours a short Retry-After on a 429, then gives up with the service code', async () => {
    const { client, google, sleeps } = setup({ service: 'gmail' });

    google.on('GET', URL_PATH, () => googleError(429, 'rateLimitExceeded', { 'Retry-After': '2' }));

    const error = await failure(client.send({ url: URL }));

    expect(error).toMatchObject({ code: 'GMAIL_UNAVAILABLE', retryAfterSec: 2, status: 429 });
    expect(sleeps).toEqual([2000, 2000]);
    expect(google.requests).toHaveLength(3);
  });

  it('leaves a long Retry-After to the job backoff instead of waiting', async () => {
    const { client, google, sleeps } = setup();

    google.on('GET', URL_PATH, () => googleError(503, undefined, { 'Retry-After': '120' }));

    const error = await failure(client.send({ url: URL }));

    expect(error).toMatchObject({ code: 'DRIVE_UNAVAILABLE', retryAfterSec: 120 });
    expect(sleeps).toEqual([]);
  });

  it('treats a rate-limit 403 like a 429', async () => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () => googleError(403, 'userRateLimitExceeded'));

    expect(await failure(client.send({ url: URL }))).toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
      reason: 'userRateLimitExceeded',
    });
  });

  it('sends a POST once, without retrying', async () => {
    const { client, google } = setup();

    google.on('POST', URL_PATH, () => googleError(500));

    expect(await failure(client.send({ method: 'POST', url: URL }))).toMatchObject({
      code: 'DRIVE_UNAVAILABLE',
    });
    expect(google.requests).toHaveLength(1);
  });

  it('retries a PATCH marked idempotent', async () => {
    const { client, google, sleeps } = setup();
    let calls = 0;

    google.on('PATCH', URL_PATH, () =>
      (calls += 1) === 1 ? googleError(503) : Response.json({ id: 'root-id' }),
    );

    await expect(
      client.json(fileSchema, { body: {}, idempotent: true, method: 'PATCH', url: URL }),
    ).resolves.toEqual({ id: 'root-id' });
    expect(sleeps).toEqual([500]);
  });

  it('ends a retry wait as soon as the signal aborts, with its reason', async () => {
    const google = new FakeGoogle().on('GET', URL_PATH, () =>
      googleError(503, undefined, { 'Retry-After': '10' }),
    );
    // The real timer: the 10 s wait must not run to its end.
    const client = new GoogleApiClient({
      fetch: google.fetch,
      service: 'drive',
      tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
    });
    const controller = new AbortController();
    const started = Date.now();

    setTimeout(() => {
      controller.abort(new Error('transfer budget exceeded'));
    }, 20);

    await expect(client.send({ signal: controller.signal, url: URL })).rejects.toThrow(
      'transfer budget exceeded',
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(google.requests).toHaveLength(1);
  });

  it('rejects with the signal’s reason when it aborts while an error reply is read', async () => {
    const controller = new AbortController();
    const reason = new Error('transfer budget exceeded');
    // The reply's body fails because of the abort, which hides Google's reason.
    const client = new GoogleApiClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              pull: (stream) => {
                controller.abort(reason);
                stream.error(reason);
              },
            }),
            { status: 400 },
          ),
        ),
      service: 'drive',
      tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
    });

    await expect(client.send({ signal: controller.signal, url: URL })).rejects.toThrow(
      'transfer budget exceeded',
    );
  });

  it('ends a token refresh that never finishes as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const google = new FakeGoogle();
    const client = new GoogleApiClient({
      fetch: google.fetch,
      service: 'drive',
      tokenProvider: {
        getAccessToken: () => {
          controller.abort(new Error('transfer budget exceeded'));

          return new Promise(() => {
            // The token endpoint stalls.
          });
        },
      },
    });

    await expect(client.send({ signal: controller.signal, url: URL })).rejects.toThrow(
      'transfer budget exceeded',
    );
    expect(google.requests).toEqual([]);
  });

  it('sends nothing when the signal has already aborted', async () => {
    const { client, google } = setup();

    await expect(
      client.send({ signal: AbortSignal.abort(new Error('cancelled')), url: URL }),
    ).rejects.toThrow('cancelled');
    expect(google.requests).toEqual([]);
  });

  it('retries a network failure, then reports the service as unavailable', async () => {
    const google = new FakeGoogle();
    const client = new GoogleApiClient({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      service: 'gmail',
      sleep: () => Promise.resolve(),
      tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
    });

    expect(await failure(client.send({ url: URL }))).toMatchObject({
      code: 'GMAIL_UNAVAILABLE',
      message: 'Gmail did not respond',
      status: undefined,
    });
    expect(google.requests).toEqual([]);
  });

  it.each([
    [401, undefined],
    [403, 'insufficientPermissions'],
    [403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'],
  ])('maps %i %s to GOOGLE_AUTH_REQUIRED', async (status, reason) => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () => googleError(status, reason));

    expect(await failure(client.send({ url: URL }))).toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
      status,
    });
    expect(google.requests).toHaveLength(1);
  });

  it('reads the reason from details when errors has none', async () => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () =>
      Response.json(
        {
          error: {
            details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
            status: 'PERMISSION_DENIED',
          },
        },
        { status: 403 },
      ),
    );

    expect(await failure(client.send({ url: URL }))).toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
      reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    });
  });

  it('maps other client errors to INTEGRATION_UNCLASSIFIED with status and reason', async () => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () => googleError(404, 'notFound'));

    const error = await failure(client.send({ url: URL }));

    expect(error).toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: 'Drive returned HTTP 404 (notFound)',
      reason: 'notFound',
      status: 404,
    });
    expect(error.message).not.toContain('fake error message');
  });

  it('drops a reason that does not look like one', async () => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () => googleError(400, 'contains spaces and <html>'));

    expect(await failure(client.send({ url: URL }))).toMatchObject({
      message: 'Drive returned HTTP 400',
      reason: undefined,
    });
  });

  it('rejects a reply that fails the schema or is not JSON', async () => {
    const { client, google } = setup();

    google.on('GET', URL_PATH, () => Response.json({ name: 'no id' }));

    expect(await failure(client.json(fileSchema, { url: URL }))).toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: 'Drive returned an unexpected response',
    });

    google.on('GET', URL_PATH, () => new Response('<html>', { status: 200 }));

    expect(await failure(client.json(fileSchema, { url: URL }))).toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
    });
  });

  it("reports a token endpoint outage as the service's unavailable code", async () => {
    const { client } = setup({
      service: 'gmail',
      tokenProvider: { getAccessToken: () => Promise.reject(new GoogleTokenUnavailableError(503)) },
    });

    expect(await failure(client.send({ url: URL }))).toMatchObject({
      code: 'GMAIL_UNAVAILABLE',
      status: 503,
    });
  });

  it('passes GOOGLE_AUTH_REQUIRED from the token provider through', async () => {
    const authRequired = new IntegrationError('GOOGLE_AUTH_REQUIRED');
    const { client } = setup({
      tokenProvider: { getAccessToken: () => Promise.reject(authRequired) },
    });

    await expect(client.send({ url: URL })).rejects.toBe(authRequired);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');

  it.each([
    [null, undefined],
    ['', undefined],
    ['30', 30],
    [' 7 ', 7],
    ['Thu, 01 Oct 2026 12:01:00 GMT', 60],
    ['Thu, 01 Oct 2026 11:59:00 GMT', 0],
    ['soon', undefined],
  ])('%s → %s', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });
});
