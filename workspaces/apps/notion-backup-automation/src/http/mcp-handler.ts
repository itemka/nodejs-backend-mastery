import type { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';

import type { RateLimiter } from '../application/ports.js';
import { ConfigError } from '../config/env.js';
import type { Logger } from '../shared/logger.js';
import { isAllowedOrigin, isMcpRequest } from './bearer-auth.js';
import { rateLimited, rateLimits } from './rate-limit.js';
import { configIncomplete, errorResponse } from './responses.js';

/** What an authenticated `/mcp` request runs on. */
export interface McpEndpoint {
  readonly limiter: RateLimiter;
  /** A fresh server with the 7 tools; called once per request. */
  readonly server: () => McpServer;
}

export interface McpHandlerDeps {
  /** `MCP_ALLOWED_ORIGINS`. */
  readonly allowedOrigins: readonly string[];
  /** `MCP_AUTH_TOKEN`. */
  readonly authToken: string;
  /** Built only for an authenticated call; throws `ConfigError` while the configuration is incomplete. */
  readonly endpoint: () => McpEndpoint;
  readonly logger: Logger;
}

/**
 * `POST /mcp` (rewritten to `/api/mcp`): the remote MCP server, stateless, over the
 * web-standard Streamable HTTP transport. Both protocol eras are served by a new server per
 * request: 2026-07-28 clients, and 2025 clients through the SDK's stateless fallback.
 *
 * In order: the bearer token (401 with `WWW-Authenticate: Bearer`), the `Origin` rule (403),
 * `POST` only (405), the configuration (503), the hourly limit (429). There is no
 * unauthenticated path to any tool.
 */
export async function handleMcpRequest(request: Request, deps: McpHandlerDeps): Promise<Response> {
  const { logger } = deps;

  if (!isMcpRequest(request, deps.authToken)) {
    logger.warn('mcp.unauthorized');

    return errorResponse(401, 'UNAUTHORIZED', { 'WWW-Authenticate': 'Bearer' });
  }

  if (!isAllowedOrigin(request, deps.allowedOrigins)) {
    logger.warn('mcp.origin_refused');

    return errorResponse(403, 'ORIGIN_NOT_ALLOWED');
  }

  // Stateless: no SSE stream to open (GET) and no session to end (DELETE).
  if (request.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', { Allow: 'POST' });
  }

  let endpoint: McpEndpoint;

  try {
    endpoint = deps.endpoint();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('mcp.config_incomplete', { invalid: error.invalid, missing: error.missing });

      return configIncomplete();
    }

    throw error;
  }

  try {
    const limit = await endpoint.limiter.take('mcp', rateLimits.mcp);

    if (!limit.allowed) {
      logger.warn('mcp.rate_limited');

      return rateLimited(limit.retryAfterSec);
    }

    // The default response mode answers with one JSON body, since no tool sends a message
    // before its result; `json` would only add a console warning per request.
    const handler = createMcpHandler(() => endpoint.server(), {
      legacy: 'stateless',
      // No change event is ever sent, and an open `subscriptions/listen` stream would only run
      // until the function's time limit, then reconnect. Refused at once instead.
      maxSubscriptions: 0,
      onerror: (error) => {
        logger.warn('mcp.protocol_error', { error });
      },
    });

    return await handler.fetch(request);
  } catch (error) {
    logger.error('mcp.failed', { error });

    return errorResponse(500, 'MCP_FAILED');
  }
}
