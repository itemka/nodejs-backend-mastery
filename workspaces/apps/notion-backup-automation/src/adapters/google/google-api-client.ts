import { setTimeout as sleepFor } from 'node:timers/promises';
import { z } from 'zod';

import type { IntegrationErrorOptions } from '../../application/integration-error.js';
import { IntegrationError } from '../../application/integration-error.js';
import type { GoogleTokenProvider } from '../../application/ports.js';
import type { ErrorCode } from '../../domain/error-catalog.js';
import { GoogleTokenUnavailableError } from './token-provider.js';

export type GoogleService = 'drive' | 'gmail';

const serviceNames: Record<GoogleService, string> = { drive: 'Drive', gmail: 'Gmail' };

const unavailableCodes = {
  drive: 'DRIVE_UNAVAILABLE',
  gmail: 'GMAIL_UNAVAILABLE',
} as const satisfies Record<GoogleService, ErrorCode>;

/** 403 reasons that mean the token lacks a scope: only a new consent fixes them. */
const scopeReasons = new Set(['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions']);
/** 403 reasons that mean "slow down": retried like a 429. */
const rateLimitReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/** In-tick retries wait at most this long; a longer `Retry-After` is left to the job's backoff. */
const MAX_IN_TICK_DELAY_SEC = 10;

/** A failed Google API call: the cataloged code, plus the HTTP status and Google's reason. */
export class GoogleApiError extends IntegrationError {
  /** Google's machine-readable reason, such as `notFound` or `insufficientFilePermissions`. */
  readonly reason: string | undefined;
  /** Undefined when no response arrived. */
  readonly status: number | undefined;

  constructor(
    code: ErrorCode,
    detail: string,
    options: IntegrationErrorOptions & { reason?: string; status?: number } = {},
  ) {
    super(code, detail, options);
    this.name = 'GoogleApiError';
    this.reason = options.reason;
    this.status = options.status;
  }
}

export interface GoogleApiRequest {
  /** Sent as JSON. */
  body?: unknown;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
  query?: Readonly<Record<string, boolean | number | string | undefined>>;
  url: string;
}

export interface GoogleApiClientOptions {
  fetch?: typeof fetch;
  /** Attempts for idempotent requests (GET, DELETE); others are sent once. */
  maxAttempts?: number;
  service: GoogleService;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  tokenProvider: GoogleTokenProvider;
}

const googleErrorBodySchema = z.object({
  error: z.object({
    details: z.array(z.object({ reason: z.string().optional() })).optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
    status: z.string().optional(),
  }),
});

const reasonPattern = /^[\w.-]{1,64}$/;

/**
 * Authenticated JSON calls to Gmail or Drive REST. Transient failures (network, timeout, 429,
 * 5xx, rate-limit 403s) of idempotent requests are retried within the call, then reported as the
 * service's `*_UNAVAILABLE` code. Errors carry status codes and reasons, never bodies or URLs.
 */
export class GoogleApiClient {
  private readonly fetch: typeof fetch;
  private readonly maxAttempts: number;
  private readonly service: GoogleService;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly tokenProvider: GoogleTokenProvider;

  constructor({
    fetch = globalThis.fetch,
    maxAttempts = 3,
    service,
    sleep = (ms) => sleepFor(ms),
    timeoutMs = 30_000,
    tokenProvider,
  }: GoogleApiClientOptions) {
    this.fetch = fetch;
    this.maxAttempts = maxAttempts;
    this.service = service;
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
    this.tokenProvider = tokenProvider;
  }

  /** Sends the request and parses the JSON reply with `schema`. */
  async json<S extends z.ZodType>(schema: S, request: GoogleApiRequest): Promise<z.output<S>> {
    const response = await this.send(request);
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw this.unexpectedResponse(response.status);
    }

    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw this.unexpectedResponse(response.status);
    }

    return parsed.data;
  }

  /** Sends the request and returns the successful response, body unread. */
  async send(request: GoogleApiRequest): Promise<Response> {
    const method = request.method ?? 'GET';
    const attempts = method === 'GET' || method === 'DELETE' ? this.maxAttempts : 1;
    const url = buildUrl(request);

    for (let attempt = 1; ; attempt += 1) {
      const token = await this.accessToken();
      let response: Response;

      try {
        response = await this.fetch(url, {
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          headers: {
            Authorization: `Bearer ${token}`,
            ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        if (attempt < attempts) {
          await this.sleep(backoffMs(attempt));
          continue;
        }

        throw new GoogleApiError(
          unavailableCodes[this.service],
          `${serviceNames[this.service]} did not respond`,
        );
      }

      if (response.ok) {
        return response;
      }

      const error = await this.toError(response);
      const delaySec = error.retryAfterSec ?? backoffMs(attempt) / 1000;

      if (
        error.code === unavailableCodes[this.service] &&
        attempt < attempts &&
        delaySec <= MAX_IN_TICK_DELAY_SEC
      ) {
        await this.sleep(delaySec * 1000);
        continue;
      }

      throw error;
    }
  }

  private async accessToken(): Promise<string> {
    try {
      return await this.tokenProvider.getAccessToken();
    } catch (error) {
      if (error instanceof GoogleTokenUnavailableError) {
        throw new GoogleApiError(unavailableCodes[this.service], error.message, {
          ...(error.status === undefined ? {} : { status: error.status }),
        });
      }

      throw error;
    }
  }

  private async toError(response: Response): Promise<GoogleApiError> {
    const { status } = response;
    const reason = await readReason(response);
    const detail = `${serviceNames[this.service]} returned HTTP ${status}${reason === undefined ? '' : ` (${reason})`}`;
    const options = {
      ...(reason === undefined ? {} : { reason }),
      status,
    };

    if (status === 401 || (status === 403 && reason !== undefined && scopeReasons.has(reason))) {
      return new GoogleApiError('GOOGLE_AUTH_REQUIRED', detail, options);
    }

    if (
      status === 429 ||
      status >= 500 ||
      (status === 403 && reason !== undefined && rateLimitReasons.has(reason))
    ) {
      const retryAfterSec = parseRetryAfter(response.headers.get('retry-after'), Date.now());

      return new GoogleApiError(unavailableCodes[this.service], detail, {
        ...options,
        ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
      });
    }

    return new GoogleApiError('INTEGRATION_UNCLASSIFIED', detail, options);
  }

  private unexpectedResponse(status: number): GoogleApiError {
    return new GoogleApiError(
      'INTEGRATION_UNCLASSIFIED',
      `${serviceNames[this.service]} returned an unexpected response`,
      { status },
    );
  }
}

function buildUrl({ query = {}, url }: GoogleApiRequest): URL {
  const result = new URL(url);

  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      result.searchParams.set(name, String(value));
    }
  }

  return result;
}

/** 0.5 s, 1 s, 2 s, … */
function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1);
}

async function readReason(response: Response): Promise<string | undefined> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  const parsed = googleErrorBodySchema.safeParse(body);

  if (!parsed.success) {
    return undefined;
  }

  const { details, errors, status } = parsed.data.error;
  const reason =
    errors?.find((item) => item.reason !== undefined)?.reason ??
    details?.find((item) => item.reason !== undefined)?.reason ??
    status;

  return reason !== undefined && reasonPattern.test(reason) ? reason : undefined;
}

/** `Retry-After` as seconds or an HTTP date; undefined when absent or unreadable. */
export function parseRetryAfter(value: null | string, nowMs: number): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }

  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  const date = Date.parse(value);

  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - nowMs) / 1000));
}
