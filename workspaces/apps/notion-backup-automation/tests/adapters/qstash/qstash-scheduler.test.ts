import { describe, expect, it } from 'vitest';

import {
  QStashScheduler,
  SchedulerError,
  workerPath,
} from '../../../src/adapters/qstash/qstash-scheduler.js';
import { createLogger } from '../../../src/shared/logger.js';
import { TEST_TOKEN } from '../../support/fixture-secrets.js';
import { FakeQStashApi, TEST_BASE_URL } from '../../support/qstash.js';

function setup() {
  const api = new FakeQStashApi();
  const logs: string[] = [];
  const scheduler = new QStashScheduler({
    api,
    appBaseUrl: TEST_BASE_URL,
    appEnv: 'prod',
    logger: createLogger({ sink: (_level, line) => logs.push(line) }),
  });

  return { api, logs, scheduler };
}

describe('QStashScheduler', () => {
  it('publishes a wakeup to the job’s worker URL, deduplicated by job and token, one at a time', async () => {
    const { api, scheduler } = setup();

    await expect(
      scheduler.schedule({
        delaySec: 300,
        jobId: '2026-10',
        reason: 'schedule',
        token: TEST_TOKEN,
      }),
    ).resolves.toEqual({ messageId: 'msg_1' });

    expect(api.published).toEqual([
      {
        body: { jobId: '2026-10', reason: 'schedule', token: TEST_TOKEN },
        deduplicationId: `2026-10.${TEST_TOKEN}`,
        delay: 300,
        flowControl: { key: 'nba-prod', parallelism: 1 },
        retries: 3,
        url: `${TEST_BASE_URL}/api/jobs/process/2026-10`,
      },
    ]);
  });

  it('sends an immediate wakeup without a delay', async () => {
    const { api, scheduler } = setup();

    await scheduler.schedule({
      delaySec: 0,
      jobId: '2026-10-r2',
      reason: 'start',
      token: TEST_TOKEN,
    });

    expect(api.published[0]).not.toHaveProperty('delay');
    expect(api.published[0]?.url).toBe(`${TEST_BASE_URL}/api/jobs/process/2026-10-r2`);
  });

  it('publishes the smoke test’s ping to the reserved _ping path', async () => {
    const { api, scheduler } = setup();

    await scheduler.ping('nonce_0123456789');

    expect(api.published).toEqual([
      {
        body: { jobId: '_ping', nonce: 'nonce_0123456789' },
        deduplicationId: '_ping.nonce_0123456789',
        flowControl: { key: 'nba-prod', parallelism: 1 },
        retries: 3,
        url: `${TEST_BASE_URL}${workerPath('_ping')}`,
      },
    ]);
  });

  it('turns a failed publish into a content-free SchedulerError', async () => {
    const { api, logs, scheduler } = setup();

    api.failures = 1;

    const failure = scheduler.schedule({
      delaySec: 0,
      jobId: '2026-10',
      reason: 'start',
      token: TEST_TOKEN,
    });

    await expect(failure).rejects.toBeInstanceOf(SchedulerError);
    await expect(failure).rejects.toThrow('QStash publish failed');
    expect(logs.join('\n')).toContain('qstash.publish.failed');
    expect(logs.join('\n')).not.toContain('eyJsecret');
  });

  it('cancels a superseded message by its ID', async () => {
    const { api, scheduler } = setup();

    await scheduler.cancel('msg_7');

    expect(api.cancelled).toEqual(['msg_7']);
  });
});
