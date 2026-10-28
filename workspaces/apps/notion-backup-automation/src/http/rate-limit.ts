import type { RateLimit } from '../application/ports.js';
import { errorResponse } from './responses.js';

const HOUR_SEC = 60 * 60;

/**
 * MCP limits bound what a leaked token or a looping client can do.
 * Telegram admission belongs to the independently deployed hub.
 */
export const rateLimits = {
  /** Every authenticated `/mcp` request; a client session takes about four. */
  mcp: { limit: 60, windowSec: HOUR_SEC },
  /** `backup_process` per job: each call publishes a QStash message. */
  mcpProcess: { limit: 10, windowSec: HOUR_SEC },
} as const satisfies Record<string, RateLimit>;

/** 429 `RATE_LIMITED`, with the seconds until the window ends. */
export function rateLimited(retryAfterSec: number): Response {
  return errorResponse(429, 'RATE_LIMITED', {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
  });
}
