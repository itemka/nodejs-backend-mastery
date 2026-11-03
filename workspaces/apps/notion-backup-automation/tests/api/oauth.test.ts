import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../api/oauth/[action].js';
import { serveMcp } from '../../src/config/control-containers.js';
import { serveOAuth } from '../../src/config/oauth-containers.js';
import { createLogger } from '../../src/shared/logger.js';
import { TEST_MCP_TOKEN } from '../support/fixture-secrets.js';

const BASE = 'https://nba.example.vercel.app';
const appRoot = path.resolve(import.meta.dirname, '../..');
const quiet = {
  logger: createLogger({
    sink: () => {
      // Not under test.
    },
  }),
};

describe('/oauth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed with 503 without configuration, as on a preview', async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
    vi.stubEnv('APP_BASE_URL', undefined);

    const reauth = await GET(new Request(`${BASE}/api/oauth/google-reauth`));

    expect(reauth.status).toBe(503);
    await expect(reauth.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });

  it('serves the phone re-login only: no OAuth server endpoints (2026-11-03)', async () => {
    const env = { APP_BASE_URL: BASE, APP_ENV: 'prod' };

    for (const route of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-authorization-server',
      '/oauth/register',
      '/oauth/token',
      '/api/oauth/authorize',
    ]) {
      const response = await serveOAuth(new Request(`${BASE}${route}`), env, quiet);

      expect(response.status, route).toBe(404);
    }

    const config = JSON.parse(readFileSync(path.join(appRoot, 'vercel.json'), 'utf8')) as {
      rewrites: { destination: string; source: string }[];
    };

    expect(
      config.rewrites.filter((rewrite) => rewrite.destination.startsWith('/api/oauth/')),
    ).toEqual([
      { destination: '/api/oauth/google-callback', source: '/oauth/google/callback' },
      { destination: '/api/oauth/google-reauth', source: '/oauth/google/reauth' },
    ]);
  });
});

describe('/mcp with the bearer token alone (2026-11-03)', () => {
  it('answers 401 with a plain challenge that names no OAuth metadata', async () => {
    const response = await serveMcp(
      new Request(`${BASE}/mcp`, { method: 'POST' }),
      {
        APP_BASE_URL: BASE,
        APP_ENV: 'prod',
        MCP_AUTH_TOKEN: TEST_MCP_TOKEN,
        UPSTASH_REDIS_REST_TOKEN: 'unused-in-this-test',
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
      },
      quiet,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });
});
