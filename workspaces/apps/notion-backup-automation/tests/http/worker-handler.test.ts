import { describe, expect, it } from 'vitest';

import { StateSchemaInvalidError } from '../../src/adapters/persistence/job-codec.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisHealthStore } from '../../src/adapters/persistence/redis-health-store.js';
import { QStashSignatureVerifier } from '../../src/adapters/qstash/qstash-signature-verifier.js';
import type { ProcessJobUseCase } from '../../src/application/process-job.js';
import { ConfigError } from '../../src/config/env.js';
import type { WorkerHandlerDeps } from '../../src/http/worker-handler.js';
import { handleWorkerRequest } from '../../src/http/worker-handler.js';
import { createLogger } from '../../src/shared/logger.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { FakeRedis } from '../support/fake-redis.js';
import { signedDelivery, TEST_BASE_URL, TEST_SIGNING_KEYS } from '../support/qstash.js';

const PATH = '/api/jobs/process/2026-10';

function setup(processJob?: () => Pick<ProcessJobUseCase, 'execute'>) {
  const harness = backupHarness();
  const redis = new FakeRedis();
  const logs: string[] = [];
  let built = 0;
  const deps: WorkerHandlerDeps = {
    appBaseUrl: TEST_BASE_URL,
    clock: harness.clock,
    health: new RedisHealthStore(redis, keyPrefixFor('test')),
    logger: createLogger({ sink: (_level, line) => logs.push(line) }),
    processJob: () => {
      built += 1;

      return processJob?.() ?? harness.processJob;
    },
    verifier: new QStashSignatureVerifier(TEST_SIGNING_KEYS),
  };

  return { built: () => built, deps, harness, logs, redis };
}

/** A started job and the token its first wakeup carries. */
async function started(harness: ReturnType<typeof backupHarness>) {
  const { job } = await harness.service.start();
  const token = job.schedule?.token;

  if (token === undefined) {
    throw new Error('The started job has no token');
  }

  return { job, token };
}

async function body(response: Response): Promise<unknown> {
  return response.json();
}

describe('handleWorkerRequest', () => {
  it('records a signed _ping’s nonce in health and touches nothing else', async () => {
    const { built, deps, harness, redis } = setup();
    const response = await handleWorkerRequest(
      signedDelivery('/api/jobs/process/_ping', { jobId: '_ping', nonce: 'nonce_0123456789' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(body(response)).resolves.toEqual({ outcome: 'ping' });
    expect([...redis.hashes.keys()]).toEqual(['{nba:test}:health']);
    expect([...(redis.hashes.get('{nba:test}:health')?.keys() ?? [])]).toEqual(['qstashPing']);
    await expect(new RedisHealthStore(redis, keyPrefixFor('test')).read()).resolves.toEqual({
      qstashPing: { nonce: 'nonce_0123456789', receivedAt: '2026-10-01T04:00:00.000Z' },
    });
    expect(redis.strings.size).toBe(0);
    await expect(harness.memory.list({ limit: 10 })).resolves.toEqual([]);
    expect(built()).toBe(0);
  });

  it('answers 401 without a genuine signature for this URL and body', async () => {
    const { deps, harness, logs } = setup();
    const { token } = await started(harness);
    const message = { jobId: '2026-10', reason: 'start', token };
    const unsigned = new Request(`${TEST_BASE_URL}${PATH}`, {
      body: JSON.stringify(message),
      method: 'POST',
    });
    const forged = signedDelivery(PATH, message, { key: 'sig_unknown_0123456789abcdefghijkl' });
    const otherJob = signedDelivery(PATH, message, {
      signedUrl: `${TEST_BASE_URL}/api/jobs/process/2026-11`,
    });
    const genuine = signedDelivery(PATH, message);
    const withQuery = new Request(`${genuine.url}?replay=1`, {
      body: JSON.stringify(message),
      headers: genuine.headers,
      method: 'POST',
    });

    for (const request of [unsigned, forged, otherJob, withQuery]) {
      const response = await handleWorkerRequest(request, deps);

      expect(response.status).toBe(401);
      await expect(body(response)).resolves.toEqual({ error: 'INVALID_SIGNATURE' });
    }

    expect(logs.filter((line) => line.includes('worker.unauthorized'))).toHaveLength(4);
    expect(harness.qstash.deliveries).toEqual([]);
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'CREATED' });
  });

  it('answers 489 for a genuine message the app never sends, or one naming another job', async () => {
    const { built, deps } = setup();
    const token = 'tok_0123456789abcdef';
    const cases = [
      signedDelivery(PATH, { jobId: '2026-11', reason: 'start', token }),
      signedDelivery(PATH, { extra: true, jobId: '2026-10', reason: 'start', token }),
      signedDelivery(PATH, { jobId: '2026-10', reason: 'nonsense', token }),
      signedDelivery(PATH, 'not json'),
      signedDelivery('/api/jobs/process/_ping', { jobId: '_ping', nonce: 'x' }),
    ];

    for (const request of cases) {
      const response = await handleWorkerRequest(request, deps);

      expect(response.status).toBe(489);
      expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
      await expect(body(response)).resolves.toEqual({ error: 'INVALID_MESSAGE' });
    }

    expect(built()).toBe(0);
  });

  it('answers 489 for a job that does not exist', async () => {
    const { deps } = setup();
    const response = await handleWorkerRequest(
      signedDelivery(PATH, { jobId: '2026-10', reason: 'start', token: 'tok_0123456789abcdef' }),
      deps,
    );

    expect(response.status).toBe(489);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    await expect(body(response)).resolves.toEqual({ error: 'JOB_NOT_FOUND' });
  });

  it('runs one tick with 200, then treats a redelivery of the same token as stale', async () => {
    const { deps, harness } = setup();
    const { token } = await started(harness);
    const message = { jobId: '2026-10', reason: 'start', token };

    const first = await handleWorkerRequest(signedDelivery(PATH, message), deps);

    expect(first.status).toBe(200);
    await expect(body(first)).resolves.toEqual({
      outcome: 'done',
      status: 'TRIGGERING_EXPORT',
      step: 'begin_trigger',
    });

    const again = await handleWorkerRequest(signedDelivery(PATH, message), deps);

    expect(again.status).toBe(200);
    await expect(body(again)).resolves.toEqual({ outcome: 'stale' });
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'TRIGGERING_EXPORT',
    });
  });

  it('answers 503 with Retry-After while another worker holds the lease', async () => {
    const { deps, harness } = setup();
    const { token } = await started(harness);

    await harness.memory.acquireLease('2026-10', 'other-worker', 42_000);

    const response = await handleWorkerRequest(
      signedDelivery(PATH, { jobId: '2026-10', reason: 'start', token }),
      deps,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('42');
    await expect(body(response)).resolves.toEqual({ error: 'LEASE_HELD' });
  });

  it('answers 500 when the next wakeup cannot be published, keeping the delivery’s token', async () => {
    const { deps, harness } = setup();
    const { token } = await started(harness);

    harness.qstash.publishFailures = 1;

    const response = await handleWorkerRequest(
      signedDelivery(PATH, { jobId: '2026-10', reason: 'start', token }),
      deps,
    );

    expect(response.status).toBe(500);
    await expect(body(response)).resolves.toEqual({ error: 'WORKER_FAILED' });

    const job = await storedJob(harness, '2026-10');

    // The step's own write is kept; the token is not rotated, so QStash's retry still runs.
    expect(job.schedule?.token).toBe(token);
  });

  it('answers 200 for an ended job', async () => {
    const { deps, harness } = setup();
    const { token } = await started(harness);

    await harness.service.cancel('2026-10', 'test');

    const response = await handleWorkerRequest(
      signedDelivery(PATH, { jobId: '2026-10', reason: 'start', token }),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(body(response)).resolves.toEqual({ outcome: 'terminal', status: 'CANCELLED' });
  });

  it('answers 489 when a stored record fails its schema', async () => {
    const { deps } = setup(() => ({
      execute: () => Promise.reject(new StateSchemaInvalidError('job', '2026-10')),
    }));
    const response = await handleWorkerRequest(
      signedDelivery(PATH, { jobId: '2026-10', reason: 'start', token: 'tok_0123456789abcdef' }),
      deps,
    );

    expect(response.status).toBe(489);
    await expect(body(response)).resolves.toEqual({ error: 'STATE_SCHEMA_INVALID' });
  });

  it('answers 503 CONFIG_INCOMPLETE when the tick’s configuration is incomplete', async () => {
    const { deps, logs } = setup(() => {
      throw new ConfigError(['GOOGLE_REFRESH_TOKEN'], []);
    });
    const response = await handleWorkerRequest(
      signedDelivery(PATH, { jobId: '2026-10', reason: 'start', token: 'tok_0123456789abcdef' }),
      deps,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBeNull();
    await expect(body(response)).resolves.toEqual({ error: 'CONFIG_INCOMPLETE' });
    expect(logs.join('\n')).toContain('GOOGLE_REFRESH_TOKEN');
  });

  it('answers 500 when Redis fails while recording a ping', async () => {
    const { deps } = setup();
    const failing: WorkerHandlerDeps = {
      ...deps,
      health: { write: () => Promise.reject(new Error('Redis unreachable')) },
    };
    const response = await handleWorkerRequest(
      signedDelivery('/api/jobs/process/_ping', { jobId: '_ping', nonce: 'nonce_0123456789' }),
      failing,
    );

    expect(response.status).toBe(500);
    await expect(body(response)).resolves.toEqual({ error: 'WORKER_FAILED' });
  });
});
