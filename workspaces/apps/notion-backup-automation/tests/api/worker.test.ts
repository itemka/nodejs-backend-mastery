import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../api/jobs/process/[jobId].js';
import { serveWorker } from '../../src/config/containers.js';
import { createLogger } from '../../src/shared/logger.js';
import { TEST_TOKEN } from '../support/fixture-secrets.js';
import { signedDelivery, TEST_BASE_URL, TEST_SIGNING_KEYS } from '../support/qstash.js';

const authEnv = {
  APP_BASE_URL: TEST_BASE_URL,
  APP_ENV: 'prod',
  QSTASH_CURRENT_SIGNING_KEY: TEST_SIGNING_KEYS.current,
  QSTASH_NEXT_SIGNING_KEY: TEST_SIGNING_KEYS.next,
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
  UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
};

const logs: string[] = [];
const silent = {
  logger: createLogger({
    sink: (_level, line) => {
      logs.push(line);
    },
  }),
};

describe('POST /api/jobs/process/[jobId]', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed with 503 when the signing configuration is missing, as on a preview', async () => {
    for (const name of Object.keys(authEnv)) {
      // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
      vi.stubEnv(name, undefined);
    }

    const response = await POST(
      signedDelivery('/api/jobs/process/_ping', { jobId: '_ping', nonce: 'nonce_0123456789' }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });

  it('answers an unsigned request with 401 before it reads anything', async () => {
    const response = await serveWorker(
      new Request(`${TEST_BASE_URL}/api/jobs/process/_ping`, { body: '{}', method: 'POST' }),
      authEnv,
      silent,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_SIGNATURE' });
  });

  it('answers a signed tick with 503 while the backup configuration is incomplete', async () => {
    const response = await serveWorker(
      signedDelivery('/api/jobs/process/2026-10', {
        jobId: '2026-10',
        reason: 'start',
        token: TEST_TOKEN,
      }),
      authEnv,
      silent,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
  });
});
