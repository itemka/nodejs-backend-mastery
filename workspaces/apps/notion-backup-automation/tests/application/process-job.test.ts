import { describe, expect, it } from 'vitest';

import { IntegrationError } from '../../src/application/integration-error.js';
import type { TickResult } from '../../src/application/process-job.js';
import type { BackupJob } from '../../src/domain/job.js';
import { newBackupJob } from '../../src/domain/job.js';
import { LEASE_TTL_MS } from '../../src/domain/next-step.js';
import type { BackupHarness } from '../support/backup-harness.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { completeJob, createdJob, valid } from '../support/jobs.js';

const MINUTE = 60;

function delays(harness: BackupHarness): number[] {
  return harness.qstash.published.map(({ delaySec }) => delaySec);
}

function eventTexts(harness: BackupHarness, jobId = '2026-10'): Promise<string[]> {
  return harness.memory
    .listEvents(jobId, { limit: 200 })
    .then((events) => events.map(({ text }) => text));
}

/** A COMPLETE job of an earlier backup, stored as the export size check's baseline. */
async function storeCompleteBackup(
  harness: BackupHarness,
  job: BackupJob = completeJob(),
): Promise<void> {
  const created = valid({
    ...newBackupJob({ kind: job.kind, now: new Date(job.createdAt), period: job.period }),
    id: job.id,
  });

  await harness.memory.create(created);
  await harness.memory.update(job.id, 1, job);
}

/** A forced job whose export has `exportSize`, after `previous` completed. */
async function shrinkRun(
  exportSize: { entryCount: number; sizeBytes: number },
  previous: BackupJob = completeJob(),
) {
  const harness = backupHarness();

  await storeCompleteBackup(harness, previous);
  harness.clock.advance(60 * 60_000);
  harness.transfer.exportSize = exportSize;
  await harness.service.start({ force: true });
  await harness.drain();

  return { harness, job: await storedJob(harness, '2026-10-r2') };
}

/**
 * Delivers the next published wakeup once inside its own publish, before the publisher saves
 * its token, and records what that early delivery got.
 */
function deliverDuringPublish(harness: BackupHarness): TickResult[] {
  const early: TickResult[] = [];

  harness.qstash.onPublish = async (wakeup) => {
    harness.qstash.onPublish = undefined;
    early.push(await harness.processJob.execute(wakeup));
  };

  return early;
}

/** A promise a test resolves by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return { promise, resolve: settle };
}

describe('ProcessJobUseCase: the happy path', () => {
  it('exports, waits for the email on the +5/+15/+30 cadence, transfers and completes', async () => {
    const harness = backupHarness();

    // The email arrives 25 minutes after the click: found at the third check (+5, +15, +30).
    harness.emails.delayMs = 25 * 60_000;

    await harness.service.start({ reason: 'test run' });
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({
      exportAttempt: 1,
      result: {
        driveFileId: 'drive1',
        entryCount: 198,
        fileName: 'notion-workspace-2026-10-01.zip',
        sizeBytes: 8_907_221,
      },
      status: 'COMPLETE',
    });
    // start → trigger → +5 m → +15 m → +30 m (found) → transfer at once.
    expect(delays(harness)).toEqual([0, 0, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, 0]);
    expect(harness.trigger.clicks).toHaveLength(1);
    expect(harness.drive.backups).toHaveLength(1);
    expect(harness.sent.map(({ kind }) => kind)).toEqual(['success']);
    await expect(harness.memory.findActive()).resolves.toBeUndefined();
    await expect(eventTexts(harness)).resolves.toEqual([
      'job.created · manual: test run',
      'CREATED → TRIGGERING_EXPORT',
      'export.click · marker saved, clicking Export',
      'TRIGGERING_EXPORT → WAITING_FOR_EMAIL (confirmed)',
      'WAITING_FOR_EMAIL → EMAIL_FOUND',
      'EMAIL_FOUND → DOWNLOADING',
      'DOWNLOADING → VERIFYING',
      'VERIFYING → UPLOADING',
      'UPLOADING → COMPLETE (uploaded)',
      'export.size · no earlier backup to compare with',
      expect.stringMatching(/^✅ Notion backup completed · job 2026-10 · 198 files \(8\.9 MB\)/),
    ]);
  });

  it('starts the +5 m countdown when the export is requested, and resets it per attempt', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob); // CREATED → TRIGGERING_EXPORT
    await harness.qstash.deliverNext(harness.processJob); // the click

    const waiting = await storedJob(harness, '2026-10');

    expect(waiting).toMatchObject({ emailCheckAttempt: 0, status: 'WAITING_FOR_EMAIL' });
    expect(harness.qstash.published.at(-1)).toMatchObject({
      delaySec: 5 * MINUTE,
      reason: 'schedule',
    });
    expect(waiting.schedule?.notBefore).toBe(
      new Date(Date.parse(waiting.requestedAt!) + 5 * MINUTE * 1000).toISOString(),
    );
  });

  it('treats Notion’s "export already running" as confirmed, without a click', async () => {
    const harness = backupHarness();

    harness.trigger.script = ['already_in_progress'];
    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);
    await harness.qstash.deliverNext(harness.processJob);

    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'WAITING_FOR_EMAIL' });
    expect(harness.trigger.clicks).toEqual([]);
  });
});

describe('ProcessJobUseCase: crashes', () => {
  // The happy path saves 11 transitions with an email at the first check; a crash after each.
  it.each(Array.from({ length: 11 }, (_, index) => index + 1))(
    'recovers from a worker killed after saved write %i, with one click per attempt and one upload',
    async (crashAfter) => {
      const harness = backupHarness();

      harness.jobs.crashAfterUpdate = crashAfter;
      await harness.service.start();
      await harness.drain();

      const job = await storedJob(harness, '2026-10');

      expect(job.status).toBe('COMPLETE');
      expect(harness.drive.backups).toHaveLength(1);
      expect(harness.trigger.clicks.length).toBeLessThanOrEqual(job.exportAttempt);
      expect(harness.qstash.dlq).toEqual([]);
      // The crash really happened: its delivery failed and was retried.
      expect(harness.qstash.deliveries.filter(({ result }) => result === 'failed')).toHaveLength(1);
      await expect(harness.memory.findActive()).resolves.toBeUndefined();
    },
  );

  it('never clicks again after the write-ahead marker: a crash before the click waits, then starts a new attempt', async () => {
    const harness = backupHarness();

    // Write 3 is the click marker: the worker dies after saving it, before the click.
    harness.jobs.crashAfterUpdate = 3;
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({ exportAttempt: 2, status: 'COMPLETE' });
    expect(harness.trigger.clicks).toHaveLength(1);
    await expect(eventTexts(harness)).resolves.toContain(
      'TRIGGERING_EXPORT → WAITING_FOR_EMAIL (in doubt)',
    );
  });

  it('rolls an orphaned transfer marker back to EMAIL_FOUND and adopts what the dead run uploaded', async () => {
    const harness = backupHarness();

    // Write 10 is UPLOADING; this run dies before uploading. Write 11 would complete the job.
    harness.jobs.crashAfterUpdate = 10;
    await harness.service.start();
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      status: 'COMPLETE',
      transferAttempt: 1,
    });
    await expect(eventTexts(harness)).resolves.toContain('UPLOADING → EMAIL_FOUND (orphaned)');
  });

  it('waits out the dead worker’s lease before running the job again', async () => {
    const harness = backupHarness();

    // Write 3 is inside the heavy trigger step: its 330 s lease outlives QStash's first retry.
    harness.jobs.crashAfterUpdate = 3;
    await harness.service.start();
    await harness.drain();

    const heldOnce = harness.qstash.deliveries.find(
      ({ result }) => result !== 'failed' && result.outcome === 'lease_held',
    );

    expect(heldOnce?.result).toEqual({
      outcome: 'lease_held',
      retryAfterSec: expect.any(Number) as number,
    });
    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
  });
});

describe('ProcessJobUseCase: Drive first', () => {
  it('adopts the period’s backup before any export (the Redis-loss guard)', async () => {
    const harness = backupHarness();

    harness.drive.backups.push({
      driveFileId: 'drive-old',
      fileName: 'notion-workspace-2026-10-01.zip',
      jobId: '2026-10',
      period: '2026-10',
      sha256: 'b'.repeat(64),
      sizeBytes: 8_900_000,
      yearFolderId: 'year2026',
    });
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({
      result: { driveFileId: 'drive-old', sizeBytes: 8_900_000 },
      status: 'COMPLETE',
    });
    expect(job.result?.entryCount).toBeUndefined();
    expect(harness.trigger.clicks).toEqual([]);
    expect(harness.sent.map(({ kind }) => kind)).toEqual(['success']);
    await expect(eventTexts(harness)).resolves.toContain(
      'TRIGGERING_EXPORT → COMPLETE (adopted from Drive)',
    );
  });

  it('does not let a forced job adopt the period’s normal backup', async () => {
    const harness = backupHarness();

    await storeCompleteBackup(harness);
    harness.drive.backups.push({
      driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      fileName: 'notion-workspace-2026-10-01.zip',
      jobId: '2026-10',
      period: '2026-10',
      sha256: 'a'.repeat(64),
      sizeBytes: 8_907_221,
      yearFolderId: 'year2026',
    });
    harness.clock.advance(60 * 60_000);

    const { job } = await harness.service.start({ force: true });

    await harness.drain();

    expect(job.id).toBe('2026-10-r2');
    expect(harness.trigger.clicks).toHaveLength(1);
    expect(harness.drive.backups).toHaveLength(2);
  });

  it('adopts a backup that appeared in Drive before the transfer starts, without a second upload', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);
    await harness.qstash.deliverNext(harness.processJob);
    harness.drive.backups.push({
      driveFileId: 'drive-race',
      fileName: 'notion-workspace-2026-10-01.zip',
      jobId: '2026-10',
      period: '2026-10',
      sha256: 'c'.repeat(64),
      sizeBytes: 8_907_221,
      yearFolderId: 'year2026',
    });
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      result: { driveFileId: 'drive-race' },
      status: 'COMPLETE',
    });
    expect(harness.transfer.runs).toEqual([]);
  });
});

describe('ProcessJobUseCase: nothing to poll', () => {
  it('publishes nothing once the job is complete, and ignores a late delivery', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.drain();

    const published = harness.qstash.published.length;
    const result = await harness.processJob.execute({
      jobId: '2026-10',
      reason: 'schedule',
      token: 'token-0000000001',
    });

    expect(result).toEqual({ outcome: 'terminal', status: 'COMPLETE' });
    expect(harness.qstash.published).toHaveLength(published);
  });

  it('answers an unknown job with not_found, publishing nothing', async () => {
    const harness = backupHarness();

    await expect(
      harness.processJob.execute({
        jobId: '2026-10',
        reason: 'schedule',
        token: 'token-0000000001',
      }),
    ).resolves.toEqual({ outcome: 'not_found' });
    expect(harness.qstash.published).toEqual([]);
  });

  it('stops polling a job that waits for you, clears its token, and sends one attention', async () => {
    const harness = backupHarness();

    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({
      incident: { code: 'NOTION_SESSION_EXPIRED', state: 'awaiting_user' },
      status: 'NEEDS_ATTENTION',
    });
    expect(job.schedule).toBeUndefined();
    expect(delays(harness)).toEqual([0, 0]);
    expect(harness.sent).toEqual([
      {
        kind: 'attention',
        notification: expect.objectContaining({
          code: 'NOTION_SESSION_EXPIRED',
          retryFromScratch: true,
        }) as unknown,
      },
    ]);
    // A stray delivery of the old token is stale.
    await expect(
      harness.processJob.execute({
        jobId: '2026-10',
        reason: 'schedule',
        token: harness.ids.tokens.at(-1)!,
      }),
    ).resolves.toEqual({ outcome: 'stale' });
    expect(harness.qstash.published).toHaveLength(2);
  });

  it('wakes a supervised incident once, +1 m, then hands it to you (no supervisor yet)', async () => {
    const harness = backupHarness();

    harness.trigger.script = [new IntegrationError('NOTION_UI_CHANGED')];
    await harness.service.start();
    await harness.drain();

    expect(delays(harness)).toEqual([0, 0, MINUTE]);
    expect(await storedJob(harness, '2026-10')).toMatchObject({
      incident: { code: 'NOTION_UI_CHANGED', state: 'awaiting_user' },
      status: 'NEEDS_ATTENTION',
    });
    expect(harness.sent.map(({ kind }) => kind)).toEqual(['attention']);
  });
});

describe('ProcessJobUseCase: failures and retries', () => {
  it('retries a transient Notion failure with backoff, then succeeds', async () => {
    const harness = backupHarness();

    harness.trigger.script = [new IntegrationError('NOTION_UNAVAILABLE')];
    await harness.service.start();
    await harness.drain();

    expect(delays(harness).slice(0, 4)).toEqual([0, 0, 5 * MINUTE, 0]);
    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
    expect(harness.trigger.clicks).toHaveLength(1);
  });

  it('respects a longer Retry-After from Gmail', async () => {
    const harness = backupHarness();

    harness.emails.failures = [
      new IntegrationError('GMAIL_UNAVAILABLE', undefined, { retryAfterSec: 1200 }),
    ];
    await harness.service.start();
    await harness.drain();

    expect(delays(harness).slice(0, 4)).toEqual([0, 0, 5 * MINUTE, 20 * MINUTE]);
    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
  });

  it('turns an unexpected exception from a port into UNKNOWN_ERROR', async () => {
    const harness = backupHarness();

    harness.trigger.requestExport = () => Promise.reject(new TypeError('a bug in the adapter'));
    await harness.service.start();
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      incident: { code: 'UNKNOWN_ERROR' },
      status: 'NEEDS_ATTENTION',
    });
    expect(harness.logs).toContainEqual(expect.objectContaining({ event: 'job.step.unexpected' }));
  });

  it('re-downloads an invalid ZIP once, then starts a new export attempt', async () => {
    const harness = backupHarness();
    const invalid = { at: 'VERIFYING' as const, error: new IntegrationError('ZIP_INVALID') };

    harness.transfer.script = [invalid, invalid];
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({ exportAttempt: 2, status: 'COMPLETE' });
    expect(harness.trigger.clicks).toHaveLength(2);
    await expect(eventTexts(harness)).resolves.toEqual(
      expect.arrayContaining([
        'VERIFYING → EMAIL_FOUND (zip invalid)',
        'VERIFYING → TRIGGERING_EXPORT (zip invalid)',
      ]),
    );
  });

  it('starts a new export attempt when the download link has expired', async () => {
    const harness = backupHarness();

    harness.transfer.script = ['link_expired'];
    await harness.service.start();
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      exportAttempt: 2,
      status: 'COMPLETE',
    });
    await expect(eventTexts(harness)).resolves.toContain(
      'EMAIL_FOUND → TRIGGERING_EXPORT (link expired)',
    );
  });

  it('rolls back a transfer that runs out of its time budget', async () => {
    const harness = backupHarness({ budgetsMs: { heavy: 30, light: 1000 } });

    harness.transfer.script = ['hang'];
    await harness.service.start();
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      status: 'COMPLETE',
      transferAttempt: 1,
    });
    await expect(eventTexts(harness)).resolves.toContain('DOWNLOADING → EMAIL_FOUND (over budget)');
  });

  it('starts a new attempt after 48 h without an email, then needs attention when none is left', async () => {
    const harness = backupHarness();

    harness.emails.arriveFor = () => 'never';
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({
      exportAttempt: 3,
      incident: { code: 'EMAIL_TIMEOUT', state: 'awaiting_user' },
      status: 'NEEDS_ATTENTION',
    });
    expect(harness.trigger.clicks).toHaveLength(3);
    expect(harness.sent.map(({ kind }) => kind)).toEqual(['attention']);
  });

  it('fails a job past its lifetime and sends a failure', async () => {
    const harness = backupHarness();

    harness.emails.arriveFor = () => 'never';
    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);
    await harness.qstash.deliverNext(harness.processJob);
    harness.clock.advance(168 * 60 * 60_000);
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      lastError: { code: 'JOB_LIFETIME_EXCEEDED' },
      status: 'FAILED',
    });
    expect(harness.sent.map(({ kind }) => kind)).toEqual(['failure']);
    await expect(harness.memory.findActive()).resolves.toBeUndefined();
  });
});

describe('ProcessJobUseCase: the export size check', () => {
  it('completes a backup that shrank from 198 files to 3, and reports it with shrink', async () => {
    const { harness, job } = await shrinkRun({ entryCount: 3, sizeBytes: 1104 });
    const shrink = {
      previousEntryCount: 198,
      previousJobId: '2026-10',
      previousSizeBytes: 8_907_221,
    };

    expect(job).toMatchObject({
      result: { entryCount: 3, shrink, sizeBytes: 1104 },
      status: 'COMPLETE',
    });
    expect(harness.sent).toEqual([
      { kind: 'success', notification: expect.objectContaining({ shrink }) as unknown },
    ]);
    await expect(eventTexts(harness, '2026-10-r2')).resolves.toContain(
      'export.shrunk · 3 files (1.1 KB); last backup (2026-10) had 198 files (8.9 MB)',
    );
  });

  it('does not flag exactly half', async () => {
    const { job } = await shrinkRun({ entryCount: 99, sizeBytes: 8_907_221 });

    expect(job.status).toBe('COMPLETE');
    expect(job.result?.shrink).toBeUndefined();
  });

  it('flags below half the size alone', async () => {
    const { job } = await shrinkRun({ entryCount: 198, sizeBytes: 4_000_000 });

    expect(job.result?.shrink).toEqual({
      previousEntryCount: 198,
      previousJobId: '2026-10',
      previousSizeBytes: 8_907_221,
    });
  });

  it('compares only the size with a baseline that has no file count', async () => {
    const adopted = completeJob();
    const { entryCount: _count, ...withoutCount } = adopted.result!;
    const { job } = await shrinkRun(
      { entryCount: 3, sizeBytes: 8_000_000 },
      valid({ ...adopted, result: withoutCount }),
    );

    expect(job.result?.shrink).toBeUndefined();
  });

  it('never blocks the backup on an earlier job it cannot read', async () => {
    const harness = backupHarness();

    harness.memory.putRawJob('2026-09', 'not a job record');
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job.status).toBe('COMPLETE');
    expect(job.result?.shrink).toBeUndefined();
    await expect(eventTexts(harness)).resolves.toContain(
      'export.size · earlier jobs could not be read; not compared',
    );
  });

  it('skips the check without an earlier COMPLETE job, and says so', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job.result?.shrink).toBeUndefined();
    await expect(eventTexts(harness)).resolves.toContain(
      'export.size · no earlier backup to compare with',
    );
  });
});

describe('ProcessJobUseCase: duplicate and stale deliveries', () => {
  it('turns a sequential duplicate into a no-op', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const [first] = harness.qstash.published;
    const request = { jobId: '2026-10', reason: 'start' as const, token: first!.token };

    await expect(harness.processJob.execute(request)).resolves.toMatchObject({
      outcome: 'done',
      step: 'begin_trigger',
    });
    await expect(harness.processJob.execute(request)).resolves.toEqual({ outcome: 'stale' });
    expect(harness.qstash.published).toHaveLength(2);
  });

  it('runs one of two concurrent duplicates; the other gets lease_held with Retry-After', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const request = {
      jobId: '2026-10',
      reason: 'start' as const,
      token: harness.qstash.published[0]!.token,
    };
    const results = await Promise.all([
      harness.processJob.execute(request),
      harness.processJob.execute(request),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: 'done', step: 'begin_trigger' }),
        { outcome: 'lease_held', retryAfterSec: LEASE_TTL_MS.light / 1000 },
      ]),
    );
    const job = await storedJob(harness, '2026-10');

    expect(job.status).toBe('TRIGGERING_EXPORT');
  });

  it('makes the old wakeup stale after backup_process rotates the token', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const old = harness.qstash.published[0]!;
    const processed = await harness.service.process('2026-10');

    expect(processed).toMatchObject({ queued: true, reason: 'queued' });
    await expect(
      harness.processJob.execute({ jobId: '2026-10', reason: 'start', token: old.token }),
    ).resolves.toEqual({ outcome: 'stale' });
    await expect(
      harness.processJob.execute({
        jobId: '2026-10',
        reason: 'manual',
        token: harness.qstash.published.at(-1)!.token,
      }),
    ).resolves.toMatchObject({ outcome: 'done', step: 'begin_trigger' });
  });

  it('keeps the delivered token when the next publish fails, so the QStash retry re-arms', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const first = harness.qstash.published[0]!;

    harness.qstash.publishFailures = 1;
    await expect(
      harness.processJob.execute({ jobId: '2026-10', reason: 'start', token: first.token }),
    ).rejects.toThrow('QStash unavailable');

    const afterFailure = await storedJob(harness, '2026-10');

    expect(afterFailure).toMatchObject({
      schedule: { token: first.token },
      status: 'TRIGGERING_EXPORT',
    });
    // The retry of the same delivery runs the next step and publishes again.
    await expect(
      harness.processJob.execute({ jobId: '2026-10', reason: 'start', token: first.token }),
    ).resolves.toMatchObject({ outcome: 'done', step: 'trigger_export' });
    expect(harness.trigger.clicks).toHaveLength(1);
  });

  it('leaves a stale message when the token save fails after the publish, and the retry re-arms', async () => {
    const harness = backupHarness();

    await harness.service.start();

    const first = harness.qstash.published[0]!;
    let schedulesSaved = 0;

    harness.jobs.failUpdate = (next) => {
      if (next.status === 'TRIGGERING_EXPORT' && next.schedule?.token !== first.token) {
        schedulesSaved += 1;

        return new Error('redis down');
      }

      return;
    };

    await expect(
      harness.processJob.execute({ jobId: '2026-10', reason: 'start', token: first.token }),
    ).rejects.toThrow('redis down');
    expect(schedulesSaved).toBe(1);

    const orphan = harness.qstash.published.at(-1)!;

    await expect(
      harness.processJob.execute({ jobId: '2026-10', reason: 'schedule', token: orphan.token }),
    ).resolves.toEqual({ outcome: 'stale' });
    await expect(
      harness.processJob.execute({ jobId: '2026-10', reason: 'start', token: first.token }),
    ).resolves.toMatchObject({ outcome: 'done', step: 'trigger_export' });
  });

  describe('a wakeup delivered before its token is saved', () => {
    it('waits during backup_process, then runs: it is never dropped as stale', async () => {
      const harness = backupHarness();

      await harness.service.start();
      await harness.qstash.deliverNext(harness.processJob);
      await harness.qstash.deliverNext(harness.processJob);

      const early = deliverDuringPublish(harness);

      await harness.service.process('2026-10');

      expect(early).toEqual([
        { outcome: 'lease_held', retryAfterSec: expect.any(Number) as number },
      ]);
      await harness.drain();
      expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
      expect(harness.qstash.deliveries.map(({ result }) => result)).not.toContainEqual({
        outcome: 'stale',
      });
    });

    it('waits during backup_retry, then runs the retried job', async () => {
      const harness = backupHarness();

      harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
      await harness.service.start();
      await harness.drain();

      const early = deliverDuringPublish(harness);

      await harness.service.retry('2026-10');

      expect(early).toEqual([
        { outcome: 'lease_held', retryAfterSec: expect.any(Number) as number },
      ]);
      await harness.drain();
      expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
    });

    it('waits during a tick’s own publish, then runs', async () => {
      const harness = backupHarness();

      await harness.service.start();

      const early = deliverDuringPublish(harness);

      await harness.qstash.deliverNext(harness.processJob);

      expect(early).toEqual([
        { outcome: 'lease_held', retryAfterSec: expect.any(Number) as number },
      ]);
      await harness.drain();
      expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'COMPLETE' });
      expect(harness.trigger.clicks).toHaveLength(1);
    });
  });

  it('skips an export email another job already claimed', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);
    await harness.qstash.deliverNext(harness.processJob);

    const [email] = harness.emails.arrived;

    await harness.memory.markEmailConsumed(email!.messageId, '2026-09');
    harness.clock.advance(5 * 60_000);
    await harness.qstash.deliverNext(harness.processJob);

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      emailCheckAttempt: 1,
      status: 'WAITING_FOR_EMAIL',
    });
    expect(harness.emails.searches.at(-1)?.excludeIds).toEqual([email!.messageId]);
    await expect(eventTexts(harness)).resolves.toContain(
      `email.skipped · email ${email!.messageId} belongs to job 2026-09`,
    );
  });
});

describe('ProcessJobUseCase: cancellation', () => {
  it('honours a cancel that arrives while the worker is in Notion: no click, then CANCELLED', async () => {
    const harness = backupHarness();

    const inBrowser = deferred();
    const click = deferred();

    harness.trigger.beforeClick = () => {
      inBrowser.resolve();

      return click.promise;
    };

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);

    const tick = harness.qstash.deliverNext(harness.processJob);

    await inBrowser.promise;

    const cancelled = await harness.service.cancel('2026-10', 'changed my mind');

    expect(cancelled.job.cancelRequestedAt).toBeDefined();
    expect(cancelled.job.status).toBe('TRIGGERING_EXPORT');
    click.resolve();
    await tick;
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'CANCELLED' });
    expect(harness.trigger.clicks).toEqual([]);
    await expect(harness.memory.findActive()).resolves.toBeUndefined();
  });

  it('cancels at the next boundary when the request lands between two steps', async () => {
    const harness = backupHarness();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob);
    await harness.service.cancel('2026-10', 'stop');
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'CANCELLED' });
    expect(harness.trigger.clicks).toEqual([]);
  });

  it('stops a transfer at its next progress marker after a cancel request', async () => {
    const harness = backupHarness();

    const run = harness.transfer.run.bind(harness.transfer);

    // While the download runs (the tick holds the lease), backup_cancel records a request.
    harness.transfer.run = (request) =>
      run({
        ...request,
        onStep: async (marker) => {
          await request.onStep?.(marker);

          if (marker === 'DOWNLOADING') {
            await harness.service.cancel('2026-10', 'stop');
          }
        },
      });
    await harness.service.start();
    await harness.drain();

    expect(await storedJob(harness, '2026-10')).toMatchObject({ status: 'CANCELLED' });
    expect(harness.drive.backups).toEqual([]);
    await expect(eventTexts(harness)).resolves.toEqual(
      expect.arrayContaining(['EMAIL_FOUND → DOWNLOADING', 'DOWNLOADING → CANCELLED']),
    );
  });
});

describe('ProcessJobUseCase: the created job', () => {
  it('carries its first token from creation, so the first wakeup can never be stale', async () => {
    const harness = backupHarness();
    const { job } = await harness.service.start();

    expect(job.schedule?.token).toBe(harness.qstash.published[0]?.token);
    expect(createdJob().schedule).toBeUndefined();
  });
});
