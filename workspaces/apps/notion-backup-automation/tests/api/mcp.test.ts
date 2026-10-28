import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as telegramPost } from '../../api/integrations/telegram.js';
import { GET, POST } from '../../api/mcp.js';
import { serveMcp, serveTelegramIntegration } from '../../src/config/containers.js';
import { createLogger } from '../../src/shared/logger.js';
import { TEST_MCP_TOKEN, TEST_WEBHOOK_SECRET } from '../support/fixture-secrets.js';

const BASE = 'https://nba.example.vercel.app';
const logs: string[] = [];
const quiet = {
  logger: createLogger({
    sink: (_level, line) => {
      logs.push(line);
    },
  }),
};

function unset(...names: string[]): void {
  for (const name of names) {
    // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
    vi.stubEnv(name, undefined);
  }
}

describe('/mcp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed with 503 without MCP_AUTH_TOKEN, as on a preview', async () => {
    unset('MCP_AUTH_TOKEN', 'MCP_ALLOWED_ORIGINS');

    for (const handler of [POST, GET]) {
      const response = await handler(
        new Request(`${BASE}/mcp`, { headers: { authorization: 'Bearer x' }, method: 'POST' }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
    }
  });

  it('refuses a token shorter than 32 characters as incomplete configuration', async () => {
    const response = await serveMcp(
      new Request(`${BASE}/mcp`, { method: 'POST' }),
      { MCP_AUTH_TOKEN: 'short' },
      quiet,
    );

    expect(response.status).toBe(503);
  });

  it('answers 401 without the token, whatever else is configured', async () => {
    const response = await serveMcp(
      new Request(`${BASE}/mcp`, { method: 'POST' }),
      { MCP_AUTH_TOKEN: TEST_MCP_TOKEN },
      quiet,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers 503 for an authenticated call while the /mcp configuration is incomplete', async () => {
    const response = await serveMcp(
      new Request(`${BASE}/mcp`, {
        headers: { authorization: `Bearer ${TEST_MCP_TOKEN}` },
        method: 'POST',
      }),
      { MCP_AUTH_TOKEN: TEST_MCP_TOKEN },
      quiet,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });
});

describe('/api/integrations/telegram', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed with 503 without TELEGRAM_HUB_TOKEN, as on a preview', async () => {
    unset('TELEGRAM_HUB_TOKEN');

    const response = await telegramPost(
      new Request(`${BASE}/api/integrations/telegram`, { body: '{}', method: 'POST' }),
    );

    expect(response.status).toBe(503);
  });

  it('answers 401 without the secret header, whatever else is configured', async () => {
    const response = await serveTelegramIntegration(
      new Request(`${BASE}/api/integrations/telegram`, { body: '{}', method: 'POST' }),
      { TELEGRAM_HUB_TOKEN: TEST_WEBHOOK_SECRET },
      quiet,
    );

    expect(response.status).toBe(401);
  });

  it('answers 503 for an authenticated update while the webhook configuration is incomplete', async () => {
    const response = await serveTelegramIntegration(
      new Request(`${BASE}/api/integrations/telegram`, {
        body: JSON.stringify({ input: { kind: 'message', text: '/status' }, updateId: 1 }),
        headers: { authorization: `Bearer ${TEST_WEBHOOK_SECRET}` },
        method: 'POST',
      }),
      { TELEGRAM_HUB_TOKEN: TEST_WEBHOOK_SECRET },
      quiet,
    );

    expect(response.status).toBe(503);
  });
});
