import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSpaFallbackRateLimit,
  spaFallbackRateLimitLimit,
  spaFallbackRoutePattern,
} from './app.js';

describe('backend/app', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps /api paths out of the spa fallback route', () => {
    expect(spaFallbackRoutePattern.test('/playground')).toBe(true);
    expect(spaFallbackRoutePattern.test('/nested/path')).toBe(true);
    expect(spaFallbackRoutePattern.test('/api/models')).toBe(false);
    expect(spaFallbackRoutePattern.test('/api')).toBe(false);
  });

  it('rate limits repeated html navigation requests to the spa fallback', async () => {
    const limiter = createSpaFallbackRateLimit();

    for (let attempt = 0; attempt < spaFallbackRateLimitLimit; attempt += 1) {
      const { next, response } = await runRateLimit(limiter, 'text/html');

      expect(next).toHaveBeenCalledOnce();
      expect(response.statusCode).toBe(200);
    }

    const { next, response } = await runRateLimit(limiter, 'text/html');

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(429);
    expect(response.body).toBeTypeOf('string');
    expect(response.getHeader('ratelimit-limit')).toBe(String(spaFallbackRateLimitLimit));
  });

  it('skips rate-limit accounting for non-html requests', async () => {
    const limiter = createSpaFallbackRateLimit();

    for (let attempt = 0; attempt < spaFallbackRateLimitLimit * 2; attempt += 1) {
      const { next, response } = await runRateLimit(limiter, '*/*');

      expect(next).toHaveBeenCalledOnce();
      expect(response.statusCode).toBe(200);
    }

    const { next, response } = await runRateLimit(limiter, 'text/html');

    expect(next).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
  });
});

async function runRateLimit(
  limiter: ReturnType<typeof createSpaFallbackRateLimit>,
  acceptHeader: string,
): Promise<{
  next: ReturnType<typeof vi.fn>;
  response: MockResponse;
}> {
  const next = vi.fn();
  const request = createMockRequest(acceptHeader);
  const response = createMockResponse();

  await limiter(request as Request, response as unknown as Response, next);

  return {
    next,
    response,
  };
}

function createMockRequest(acceptHeader: string) {
  return {
    app: {
      get(setting: string) {
        if (setting === 'trust proxy') {
          return false;
        }

        return;
      },
    },
    get(headerName: string) {
      if (headerName.toLowerCase() === 'accept') {
        return acceptHeader;
      }

      return;
    },
    headers: {
      accept: acceptHeader,
    },
    ip: '127.0.0.1',
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

interface MockResponse {
  body?: unknown;
  getHeader(name: string): string | undefined;
  headersSent: boolean;
  send(body: unknown): MockResponse;
  setHeader(name: string, value: string): void;
  status(code: number): MockResponse;
  statusCode: number;
  writableEnded: boolean;
}

function createMockResponse(): MockResponse {
  const headers = new Map<string, string>();

  return {
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    headersSent: false,
    send(body: unknown) {
      this.body = body;
      this.headersSent = true;
      this.writableEnded = true;

      return this;
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;

      return this;
    },
    statusCode: 200,
    writableEnded: false,
  };
}
