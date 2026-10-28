import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisRateLimiter } from '../../src/adapters/persistence/redis-rate-limiter.js';
import type { McpHandlerDeps } from '../../src/http/mcp-handler.js';
import { handleMcpRequest } from '../../src/http/mcp-handler.js';
import { createMcpServer } from '../../src/mcp/server.js';
import type { BackupToolDeps } from '../../src/mcp/tools.js';
import type { HealthSettings } from '../../src/mcp/views.js';
import type { BackupHarness } from './backup-harness.js';
import { backupHarness } from './backup-harness.js';
import { FakeRedis } from './fake-redis.js';
import { TEST_MCP_TOKEN } from './fixture-secrets.js';

export const MCP_URL = 'https://nba.example.vercel.app/mcp';

export const defaultSettings: HealthSettings = {
  agent: { configured: true, model: 'gemini-2.5-flash', provider: 'gemini' },
  autoStartEnabled: false,
  heartbeatConfigured: true,
  notifications: { channels: ['console', 'telegram'], missing: [] },
};

export interface McpHarness extends BackupHarness {
  readonly deps: McpHandlerDeps;
  readonly redis: FakeRedis;
  /** Serves one request as `/mcp` does. */
  readonly serve: (request: Request) => Promise<Response>;
}

/** `/mcp` on the backup harness: the same service, clock and fakes, with a Redis-backed limiter. */
export function mcpHarness(
  options: { overrides?: Partial<BackupToolDeps>; settings?: HealthSettings } = {},
): McpHarness {
  const harness = backupHarness();
  const redis = new FakeRedis();
  const limiter = new RedisRateLimiter(redis, keyPrefixFor('test'), harness.clock);
  const deps: McpHandlerDeps = {
    allowedOrigins: [],
    authToken: TEST_MCP_TOKEN,
    endpoint: () => ({
      limiter,
      server: () =>
        createMcpServer({
          clock: harness.clock,
          health: harness.health,
          limiter,
          logger: harness.logger,
          service: harness.service,
          settings: options.settings ?? defaultSettings,
          version: 'test',
          ...options.overrides,
        }),
    }),
    logger: harness.logger,
  };

  return {
    ...harness,
    deps,
    redis,
    serve: (request) => handleMcpRequest(request, deps),
  };
}

/**
 * A real MCP client over Streamable HTTP, whose requests go to `serve` with the bearer token:
 * `legacy` speaks the 2025 handshake, `auto` negotiates the 2026-07-28 era.
 */
export async function connectClient(
  serve: (request: Request) => Promise<Response>,
  mode: 'auto' | 'legacy' = 'legacy',
): Promise<Client> {
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => serve(new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${TEST_MCP_TOKEN}` } },
  });

  await client.connect(transport);

  return client;
}
