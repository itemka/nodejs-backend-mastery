import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/config/env.js';
import { isAllowedOrigin } from '../../src/http/bearer-auth.js';
import { secretEquals } from '../../src/http/cron-auth.js';
import { handleMcpRequest } from '../../src/http/mcp-handler.js';
import { TEST_MCP_TOKEN } from '../support/fixture-secrets.js';
import { connectClient, MCP_URL, mcpHarness } from '../support/mcp.js';

const listTools = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list', params: {} });

function post(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(MCP_URL, {
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    method,
    ...(method === 'POST' ? { body: listTools } : {}),
  });
}

const bearer = { authorization: `Bearer ${TEST_MCP_TOKEN}` };

describe('secretEquals', () => {
  it('matches the exact secret only, and never a missing value', () => {
    expect(secretEquals(TEST_MCP_TOKEN, TEST_MCP_TOKEN)).toBe(true);
    expect(secretEquals(`${TEST_MCP_TOKEN} `, TEST_MCP_TOKEN)).toBe(false);
    expect(secretEquals(TEST_MCP_TOKEN.slice(0, -1), TEST_MCP_TOKEN)).toBe(false);

    expect(secretEquals(null, TEST_MCP_TOKEN)).toBe(false);
    expect(secretEquals('', TEST_MCP_TOKEN)).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it('lets a request without Origin through, and a browser’s only when listed', () => {
    expect(isAllowedOrigin(post(), [])).toBe(true);
    expect(isAllowedOrigin(post({ origin: 'https://evil.example' }), [])).toBe(false);
    expect(isAllowedOrigin(post({ origin: 'https://claude.ai' }), ['https://claude.ai'])).toBe(
      true,
    );
  });
});

describe('POST /mcp', () => {
  it('answers 401 with WWW-Authenticate without the token, building nothing', async () => {
    const harness = mcpHarness();
    let built = 0;
    const deps = {
      ...harness.deps,
      endpoint: () => {
        built += 1;

        return harness.deps.endpoint();
      },
    };

    for (const headers of [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: TEST_MCP_TOKEN },
    ]) {
      const response = await handleMcpRequest(post(headers), deps);

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
    }

    expect(built).toBe(0);
    expect(harness.redis.strings.size).toBe(0);
  });

  it('refuses a browser Origin that is not listed, with 403', async () => {
    const harness = mcpHarness();
    const response = await harness.serve(post({ ...bearer, origin: 'https://evil.example' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'ORIGIN_NOT_ALLOWED' });
  });

  it('accepts a listed Origin', async () => {
    const harness = mcpHarness();
    const response = await handleMcpRequest(post({ ...bearer, origin: 'https://claude.ai' }), {
      ...harness.deps,
      allowedOrigins: ['https://claude.ai'],
    });

    expect(response.status).toBe(200);
  });

  it('answers 405 to GET and DELETE: there is no stream or session to open', async () => {
    const harness = mcpHarness();

    for (const method of ['GET', 'DELETE']) {
      const response = await harness.serve(post(bearer, method));

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('fails closed with 503 while the configuration is incomplete', async () => {
    const harness = mcpHarness();
    const response = await handleMcpRequest(post(bearer), {
      ...harness.deps,
      endpoint: () => {
        throw new ConfigError(['QSTASH_TOKEN'], []);
      },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });

  it('serves tools/list to an authenticated client', async () => {
    const harness = mcpHarness();
    const client = await connectClient(harness.serve);
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(7);
  });

  it('allows 60 authenticated requests an hour, then answers 429 with Retry-After', async () => {
    const harness = mcpHarness();

    for (let index = 0; index < 60; index += 1) {
      await expect(harness.serve(post(bearer))).resolves.toMatchObject({ status: 200 });
    }

    const limited = await harness.serve(post(bearer));

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    await expect(limited.json()).resolves.toEqual({ error: 'RATE_LIMITED' });

    harness.clock.advance(60 * 60 * 1000);

    await expect(harness.serve(post(bearer))).resolves.toMatchObject({ status: 200 });
  });

  it('counts no unauthenticated request against the limit', async () => {
    const harness = mcpHarness();

    for (let index = 0; index < 100; index += 1) {
      await harness.serve(post());
    }

    await expect(harness.serve(post(bearer))).resolves.toMatchObject({ status: 200 });
  });

  it('answers 500 without details when the limiter fails', async () => {
    const harness = mcpHarness();
    const response = await handleMcpRequest(post(bearer), {
      ...harness.deps,
      endpoint: () => ({
        ...harness.deps.endpoint(),
        limiter: { take: () => Promise.reject(new Error('redis down at https://db.example')) },
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'MCP_FAILED' });
  });
});
