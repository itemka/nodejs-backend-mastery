import { describe, expect, it } from 'vitest';

import { ApplicationError } from '../../src/application/application-error.js';
import {
  BackupApplicationService,
  CONTROL_LEASE_MS,
} from '../../src/application/backup-service.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import { createLogger } from '../../src/shared/logger.js';
import type { BackupHarness } from '../support/backup-harness.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { ManualClock } from '../support/manual-clock.js';

async function errorOf(promise: Promise<unknown>): Promise<ApplicationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApplicationError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected an ApplicationError');
}

/** Runs ticks until the job reaches `status`. */
async function tickUntil(harness: BackupHarness, jobId: string, status: string): Promise<void> {
  for (let tick = 0; tick < 50; tick += 1) {
    const job = await storedJob(harness, jobId);

    if (job.status === status) {
      return;
    }

    await harness.qstash.deliverNext(harness.processJob);
  }

  throw new Error(`Job ${jobId} never reached ${status}`);
}

/** A second service on the same Redis, with its own clock: another function instance. */
function serviceAt(harness: BackupHarness, at: string): BackupApplicationService {
  const lines: string[] = [];

  return new BackupApplicationService({
    clock: new ManualClock(at),
    ids: harness.ids,
    jobs: harness.jobs,
    logger: createLogger({
      sink: (_level, line) => {
        lines.push(line);
      },
    }),
    policy: harness.policy,
    scheduler: harness.qstash,
    timeZone: 'Europe/Warsaw',
  });
}

describe('BackupApplicationService.start', () => {
  it('creates the period’s job with its first token and publishes an immediate wakeup for it', async () => {
    const harness = backupHarness();
    const { created, job } = await harness.service.start({ kind: 'scheduled' });

    expect(created).toBe(true);
    expect(job).toMatchObject({
      id: '2026-10',
      kind: 'scheduled',
      period: '2026-10',
      status: 'CREATED',
    });
    expect(harness.qstash.published).toEqual([
      expect.objectContaining({
        delaySec: 0,
        jobId: '2026-10',
        reason: 'start',
        token: job.schedule?.token,
      }),
    ]);
    await expect(harness.memory.findActive()).resolves.toMatchObject({ job: { id: '2026-10' } });
  });

  it('derives the period in the backup time zone', async () => {
    // 23:30 UTC on 31 October is already 1 November in Warsaw.
    const harness = backupHarness({ start: '2026-10-31T23:30:00.000Z' });

    await expect(harness.service.start()).resolves.toMatchObject({ job: { id: '2026-11' } });
  });

  it('returns the period’s existing job, even a completed one, and publishes nothing', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.drain();

    const published = harness.qstash.published.length;

    await expect(harness.service.start()).resolves.toMatchObject({
      created: false,
      job: { id: '2026-10', status: 'COMPLETE' },
    });
    expect(harness.qstash.published).toHaveLength(published);
  });

  it('creates exactly one job for 20 concurrent starts, and one export', async () => {
    const harness = backupHarness();
    const results = await Promise.all(Array.from({ length: 20 }, () => harness.service.start()));

    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(new Set(results.map(({ job }) => job.id))).toEqual(new Set(['2026-10']));
    await expect(harness.memory.list({ limit: 10 })).resolves.toHaveLength(1);
    // A start that finds the job still CREATED publishes its first token again: one token, so
    // QStash's deduplication delivers it once, and any later repeat is stale.
    expect(new Set(harness.qstash.published.map(({ token }) => token)).size).toBe(1);

    await harness.drain();

    expect(harness.trigger.clicks).toHaveLength(1);
    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
  });

  it('publishes the first wakeup again when a start is retried after its publish failed', async () => {
    const harness = backupHarness();

    harness.qstash.publishFailures = 1;
    await expect(harness.service.start()).rejects.toThrow('QStash unavailable');
    expect(harness.qstash.pendingCount()).toBe(0);

    const { created, job } = await harness.service.start();

    expect(created).toBe(false);
    expect(harness.qstash.published).toEqual([
      expect.objectContaining({ delaySec: 0, reason: 'start', token: job.schedule?.token }),
    ]);

    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
  });

  it('publishes nothing again for an existing job past CREATED', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);

    const published = harness.qstash.published.length;

    await expect(harness.service.start()).resolves.toMatchObject({
      created: false,
      job: { status: 'TRIGGERING_EXPORT' },
    });
    expect(harness.qstash.published).toHaveLength(published);
  });

  it('refuses a second period while a job is active, even when both start at once', async () => {
    const harness = backupHarness();
    const october = serviceAt(harness, '2026-10-31T20:00:00.000Z');
    const november = serviceAt(harness, '2026-11-01T05:00:00.000Z');
    const results = await Promise.allSettled([october.start(), november.start()]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);

    const refused = results.find((result) => result.status === 'rejected');

    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({
      code: 'ACTIVE_JOB_EXISTS',
    });
  });

  it('forces a new job for the period only once no job is active: r2, then r3', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await expect(errorOf(harness.service.start({ force: true }))).resolves.toMatchObject({
      code: 'ACTIVE_JOB_EXISTS',
      jobId: '2026-10',
    });
    await harness.drain();

    await expect(harness.service.start({ force: true })).resolves.toMatchObject({
      created: true,
      job: { id: '2026-10-r2', kind: 'forced' },
    });
    await harness.drain();
    await expect(harness.service.start({ force: true })).resolves.toMatchObject({
      job: { id: '2026-10-r3' },
    });
  });

  it('keeps the caller’s reason in the first event, without links or tokens', async () => {
    const harness = backupHarness();

    await harness.service.start({
      reason: 'see https://example.com/x?token=abc and Bearer abc.def-123 please',
    });

    const [event] = await harness.memory.listEvents('2026-10', { limit: 1 });

    expect(event?.text).toBe('job.created · manual: see [link] and Bearer [redacted] please');
  });
});

describe('BackupApplicationService.process', () => {
  it('rotates the token, publishes an immediate wakeup and cancels the superseded one', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);
    await harness.qstash.deliverNext(harness.processJob);

    const waiting = await storedJob(harness, '2026-10');
    const result = await harness.service.process('2026-10');

    expect(result).toMatchObject({ queued: true, reason: 'queued' });
    expect(result.job.schedule?.token).not.toBe(waiting.schedule?.token);
    expect(harness.qstash.published.at(-1)).toMatchObject({
      delaySec: 0,
      reason: 'manual',
      token: result.job.schedule?.token,
    });
    expect(harness.qstash.cancelled).toEqual([waiting.schedule?.messageId]);
  });

  it('queues nothing for a terminal job or one a worker holds', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.memory.acquireLease('2026-10', 'another-worker', 60_000);
    await expect(harness.service.process('2026-10')).resolves.toMatchObject({
      queued: false,
      reason: 'leased',
    });

    harness.clock.advance(60_000);
    await harness.drain();
    await expect(harness.service.process('2026-10')).resolves.toMatchObject({
      queued: false,
      reason: 'terminal',
    });
  });

  it('keeps the old token when the publish fails', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const before = await storedJob(harness, '2026-10');

    harness.qstash.publishFailures = 1;
    await expect(harness.service.process('2026-10')).rejects.toThrow('QStash unavailable');

    const after = await storedJob(harness, '2026-10');

    expect(after.schedule).toEqual(before.schedule);
    await expect(harness.memory.acquireLease('2026-10', 'next', 1000)).resolves.toEqual({
      acquired: true,
    });
  });

  it('names an unknown job', async () => {
    await expect(errorOf(backupHarness().service.process('2026-09'))).resolves.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
  });
});

describe('BackupApplicationService.retry', () => {
  it('resumes a job that needs attention from its failed stage, with a wakeup', async () => {
    const harness = backupHarness();

    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.service.start();
    await harness.drain();

    const { job } = await harness.service.retry('2026-10');

    expect(job).toMatchObject({ status: 'TRIGGERING_EXPORT' });
    expect(job.incident).toBeUndefined();
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'retry' });

    await harness.drain();
    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
    await expect(harness.memory.listEvents('2026-10', { limit: 200 })).resolves.toContainEqual(
      expect.objectContaining({ text: 'NEEDS_ATTENTION → TRIGGERING_EXPORT (backup_retry)' }),
    );
  });

  it('retries from scratch: a new export attempt once this attempt clicked', async () => {
    const harness = backupHarness();

    harness.emails.arriveFor = () => 'never';
    await harness.service.start();
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      exportAttempt: 3,
      status: 'NEEDS_ATTENTION',
    });
    await expect(
      errorOf(harness.service.retry('2026-10', 'NOTION_TRIGGER')),
    ).resolves.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('refuses a job that does not wait for a retry, publishing nothing', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const error = await errorOf(harness.service.retry('2026-10'));

    expect(error).toMatchObject({ code: 'INVALID_STATE' });
    expect(error.message).toBe('Job 2026-10 cannot do that while CREATED (UNEXPECTED_STATUS)');
    expect(harness.qstash.published).toHaveLength(1);
  });

  it('refuses while a worker holds the job', async () => {
    const harness = backupHarness();

    harness.trigger.script = [new IntegrationError('NOTION_UNAVAILABLE')];
    await harness.service.start();
    await tickUntil(harness, '2026-10', 'RETRYABLE_FAILURE');
    await harness.memory.acquireLease('2026-10', 'another-worker', CONTROL_LEASE_MS);

    await expect(errorOf(harness.service.retry('2026-10'))).resolves.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});

describe('BackupApplicationService.cancel', () => {
  it('cancels a job no worker holds at once, ends it and cancels its pending wakeup', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await tickUntil(harness, '2026-10', 'WAITING_FOR_EMAIL');

    const waiting = await storedJob(harness, '2026-10');
    const pending = waiting.schedule?.messageId;
    const { job } = await harness.service.cancel('2026-10', 'not this month');

    expect(job.status).toBe('CANCELLED');
    expect(pending).toBe('msg-3');
    expect(harness.qstash.cancelled).toEqual([pending]);
    expect(harness.qstash.pendingCount()).toBe(0);
    await expect(harness.memory.findActive()).resolves.toBeUndefined();
    await expect(harness.memory.listEvents('2026-10', { limit: 10 })).resolves.toContainEqual(
      expect.objectContaining({ text: 'cancel.requested · not this month', type: 'note' }),
    );
  });

  it('records the request for the next boundary while a worker holds the job', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.memory.acquireLease('2026-10', 'worker', 60_000);

    const { job } = await harness.service.cancel('2026-10', 'stop');

    expect(job).toMatchObject({
      cancelRequestedAt: harness.clock.now().toISOString(),
      status: 'CREATED',
    });
  });

  it('refuses a job that has ended', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.drain();

    await expect(errorOf(harness.service.cancel('2026-10', 'late'))).resolves.toMatchObject({
      code: 'INVALID_STATE',
      message: 'Job 2026-10 is already COMPLETE',
    });
  });
});

describe('BackupApplicationService.status and list', () => {
  it('shows the given job, else the active one, else the latest, with recent events', async () => {
    const harness = backupHarness();

    await expect(errorOf(harness.service.status())).resolves.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });

    await harness.service.start();
    await expect(harness.service.status()).resolves.toMatchObject({
      job: { id: '2026-10', status: 'CREATED' },
    });

    await harness.drain();

    const latest = await harness.service.status();

    expect(latest.job.status).toBe('COMPLETE');
    expect(latest.events.length).toBeLessThanOrEqual(10);
    await expect(harness.service.status('2026-10')).resolves.toMatchObject({
      job: { id: '2026-10' },
    });
    await expect(errorOf(harness.service.status('2026-09'))).resolves.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
    await expect(harness.service.list(12)).resolves.toEqual([
      expect.objectContaining({ id: '2026-10' }),
    ]);
  });
});
