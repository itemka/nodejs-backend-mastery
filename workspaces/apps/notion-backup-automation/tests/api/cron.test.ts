import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../api/cron/daily.js';
import { serveCron } from '../../src/config/containers.js';
import { createLogger } from '../../src/shared/logger.js';

const SECRET = 'cron-secret-0123456789abcdefghijklmnopqrstuv';
const URL_BASE = 'https://nba.example.vercel.app/api/cron/daily';
const logs: string[] = [];
const quiet = {
  logger: createLogger({
    sink: (_level, line) => {
      logs.push(line);
    },
  }),
};

describe('GET /api/cron/daily', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed with 503 without CRON_SECRET, as on a preview', async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
    vi.stubEnv('CRON_SECRET', undefined);

    const response = await GET(new Request(URL_BASE, { headers: { authorization: 'Bearer x' } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });

  it('answers 401 without the secret, whatever else is configured', async () => {
    const response = await serveCron(new Request(URL_BASE), { CRON_SECRET: SECRET }, quiet);

    expect(response.status).toBe(401);
  });

  it('answers 503 for an authenticated call while the cron configuration is incomplete', async () => {
    const response = await serveCron(
      new Request(`${URL_BASE}?probe=google`, { headers: { authorization: `Bearer ${SECRET}` } }),
      { CRON_SECRET: SECRET },
      quiet,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });
});
