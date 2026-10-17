import { describe, expect, it } from 'vitest';

import type { JobRepository, StoredJob } from '../../src/application/ports.js';
import type { JobEvent } from '../../src/domain/job-event.js';
import { MAX_JOB_EVENTS } from '../../src/domain/job-event.js';
import { beginExportTrigger, cancelJob } from '../../src/domain/job-lifecycle.js';
import type { BackupJob } from '../../src/domain/job.js';
import { newBackupJob } from '../../src/domain/job.js';

export interface ContractContext {
  /** Lets lease TTLs expire: a fake clock moves, a live run waits. */
  advance: (ms: number) => Promise<void>;
  /** A repository with no data, isolated from every other test. */
  repository: JobRepository;
}

const baseTime = Date.parse('2026-10-01T04:00:00.000Z');

function jobFor(period: string, minute = 0, revision?: number): BackupJob {
  return newBackupJob({
    kind: revision === undefined ? 'manual' : 'forced',
    now: new Date(baseTime + minute * 60_000),
    period,
    ...(revision === undefined ? {} : { revision }),
  });
}

function eventAt(second: number, text = `event ${second}`): JobEvent {
  return { at: new Date(baseTime + second * 1000).toISOString(), text, type: 'transition' };
}

async function createOrFail(repository: JobRepository, job: BackupJob): Promise<StoredJob> {
  const result = await repository.create(job);

  if (result.outcome !== 'created') {
    throw new Error(`Expected created, got ${result.outcome}`);
  }

  return result.stored;
}

async function outcomeOf(result: Promise<{ outcome: string }>): Promise<string> {
  const { outcome } = await result;

  return outcome;
}

async function versionOf(result: Promise<StoredJob | undefined>): Promise<number | undefined> {
  const stored = await result;

  return stored?.version;
}

async function idOf(result: Promise<StoredJob | undefined>): Promise<string | undefined> {
  const stored = await result;

  return stored?.job.id;
}

async function finish(repository: JobRepository, stored: StoredJob): Promise<void> {
  const result = await repository.update(
    stored.job.id,
    stored.version,
    cancelJob(stored.job, new Date(baseTime + 3_600_000)),
  );

  expect(result.outcome).toBe('updated');
}

/** The `JobRepository` contract, run against the in-memory fake (CI) and live Redis (`test:live`). */
export function describeJobRepositoryContract(
  name: string,
  setup: () => ContractContext | Promise<ContractContext>,
): void {
  describe(`JobRepository contract: ${name}`, () => {
    describe('create', () => {
      it('stores a CREATED job with version 1 and makes it the active job', async () => {
        const { repository } = await setup();
        const job = jobFor('2026-10');

        expect(await repository.create(job)).toEqual({
          outcome: 'created',
          stored: { job, version: 1 },
        });
        expect(await repository.get('2026-10')).toEqual({ job, version: 1 });
        expect(await idOf(repository.findActive())).toBe('2026-10');
      });

      it('returns the existing job for a repeated start of the same period', async () => {
        const { repository } = await setup();
        const first = await createOrFail(repository, jobFor('2026-10'));

        expect(await repository.create(jobFor('2026-10', 5))).toEqual({
          outcome: 'exists',
          stored: first,
        });
      });

      it('returns the period’s job even after it ended, so a period never gets a second normal job', async () => {
        const { repository } = await setup();
        const first = await createOrFail(repository, jobFor('2026-10'));

        await finish(repository, first);

        expect(await outcomeOf(repository.create(jobFor('2026-10', 90)))).toBe('exists');
      });

      it('refuses any new job while another one is active, forced ones included', async () => {
        const { repository } = await setup();

        await createOrFail(repository, jobFor('2026-10'));

        expect(await repository.create(jobFor('2026-11', 1))).toEqual({
          activeJobId: '2026-10',
          outcome: 'active_exists',
        });
        expect(await repository.create(jobFor('2026-10', 1, 2))).toEqual({
          activeJobId: '2026-10',
          outcome: 'active_exists',
        });
      });

      it('creates a forced job once nothing is active, and a forced ID only once', async () => {
        const { repository } = await setup();

        await finish(repository, await createOrFail(repository, jobFor('2026-10')));

        const forced = await createOrFail(repository, jobFor('2026-10', 90, 2));

        expect(forced.job.id).toBe('2026-10-r2');
        await finish(repository, forced);
        expect(await outcomeOf(repository.create(jobFor('2026-10', 120, 2)))).toBe('exists');
      });

      it('creates exactly one job from 20 concurrent starts of the same period', async () => {
        const { repository } = await setup();
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, index) => repository.create(jobFor('2026-10', index))),
        );

        expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1);
        expect(results.filter((result) => result.outcome === 'exists')).toHaveLength(19);
        expect(await repository.list({ limit: 24 })).toHaveLength(1);
      });

      it('creates exactly one job from 20 concurrent starts of different periods', async () => {
        const { repository } = await setup();
        const periods = Array.from({ length: 20 }, (_, index) => `20${String(10 + index)}-10`);
        const results = await Promise.all(
          periods.map((period) => repository.create(jobFor(period))),
        );

        expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1);
        expect(results.filter((result) => result.outcome === 'active_exists')).toHaveLength(19);
      });

      it('accepts only CREATED jobs', async () => {
        const { repository } = await setup();
        const triggering = beginExportTrigger(jobFor('2026-10'), new Date(baseTime + 60_000));

        await expect(repository.create(triggering)).rejects.toThrow(RangeError);
      });
    });

    describe('update', () => {
      it('writes with the expected version and increments it', async () => {
        const { repository } = await setup();
        const stored = await createOrFail(repository, jobFor('2026-10'));
        const next = beginExportTrigger(stored.job, new Date(baseTime + 60_000));

        expect(await repository.update('2026-10', 1, next)).toEqual({
          outcome: 'updated',
          version: 2,
        });
        expect(await repository.get('2026-10')).toEqual({ job: next, version: 2 });
      });

      it('rejects a stale version and keeps the stored job', async () => {
        const { repository } = await setup();
        const stored = await createOrFail(repository, jobFor('2026-10'));
        const next = beginExportTrigger(stored.job, new Date(baseTime + 60_000));

        await repository.update('2026-10', 1, next);

        expect(await repository.update('2026-10', 1, next)).toEqual({
          outcome: 'conflict',
          version: 2,
        });
        expect(await versionOf(repository.get('2026-10'))).toBe(2);
      });

      it('lets exactly one of 20 concurrent updates with the same version win', async () => {
        const { repository } = await setup();
        const stored = await createOrFail(repository, jobFor('2026-10'));
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            repository.update(
              '2026-10',
              stored.version,
              beginExportTrigger(stored.job, new Date(baseTime + (index + 1) * 1000)),
            ),
          ),
        );

        expect(results.filter((result) => result.outcome === 'updated')).toEqual([
          { outcome: 'updated', version: 2 },
        ]);
        expect(results.filter((result) => result.outcome === 'conflict')).toHaveLength(19);
      });

      it('reports an unknown job', async () => {
        const { repository } = await setup();

        expect(await repository.update('2026-10', 1, jobFor('2026-10'))).toEqual({
          outcome: 'not_found',
        });
      });

      it('clears the active job on a terminal status, which allows the next period', async () => {
        const { repository } = await setup();

        await finish(repository, await createOrFail(repository, jobFor('2026-10')));

        expect(await repository.findActive()).toBeUndefined();
        expect(await outcomeOf(repository.create(jobFor('2026-11', 2)))).toBe('created');
      });

      it('refuses a record for another job ID', async () => {
        const { repository } = await setup();

        await createOrFail(repository, jobFor('2026-10'));

        await expect(repository.update('2026-10', 1, jobFor('2026-11'))).rejects.toThrow(
          RangeError,
        );
      });

      it('refuses to write a record that fails the job schema', async () => {
        const { repository } = await setup();
        const stored = await createOrFail(repository, jobFor('2026-10'));
        const invalid = { ...stored.job, status: 'NEEDS_ATTENTION' } as const;

        await expect(repository.update('2026-10', 1, invalid)).rejects.toMatchObject({
          code: 'STATE_SCHEMA_INVALID',
        });
        expect(await versionOf(repository.get('2026-10'))).toBe(1);
      });
    });

    describe('get and list', () => {
      it('returns undefined for an unknown job', async () => {
        const { repository } = await setup();

        expect(await repository.get('2026-10')).toBeUndefined();
        expect(await repository.findActive()).toBeUndefined();
        expect(await repository.list({ limit: 12 })).toEqual([]);
      });

      it('lists the newest jobs first, up to the limit', async () => {
        const { repository } = await setup();

        for (const [minute, period] of ['2026-08', '2026-09', '2026-10'].entries()) {
          await finish(repository, await createOrFail(repository, jobFor(period, minute * 10)));
        }

        const listed = await repository.list({ limit: 2 });

        expect(listed.map((stored) => [stored.job.id, stored.version])).toEqual([
          ['2026-10', 2],
          ['2026-09', 2],
        ]);
      });
    });

    describe('leases', () => {
      it('gives the lease to one worker until it is released', async () => {
        const { repository } = await setup();

        expect(await repository.acquireLease('2026-10', 'worker-a', 60_000)).toEqual({
          acquired: true,
        });

        const held = await repository.acquireLease('2026-10', 'worker-b', 60_000);

        expect(held.acquired).toBe(false);
        expect(held.acquired ? 0 : held.remainingMs).toBeGreaterThan(50_000);
        expect(await repository.releaseLease('2026-10', 'worker-b')).toBe(false);
        expect(await repository.releaseLease('2026-10', 'worker-a')).toBe(true);
        expect(await repository.acquireLease('2026-10', 'worker-b', 60_000)).toEqual({
          acquired: true,
        });
      });

      it('gives exactly one of 20 concurrent workers the lease', async () => {
        const { repository } = await setup();
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            repository.acquireLease('2026-10', `worker-${index}`, 60_000),
          ),
        );

        expect(results.filter((result) => result.acquired)).toHaveLength(1);
      });

      it('expires after its TTL', async () => {
        const { advance, repository } = await setup();

        await repository.acquireLease('2026-10', 'worker-a', 300);
        await advance(600);

        expect(await repository.acquireLease('2026-10', 'worker-b', 60_000)).toEqual({
          acquired: true,
        });
        expect(await repository.releaseLease('2026-10', 'worker-a')).toBe(false);
      });
    });

    describe('events', () => {
      it('returns the newest events, oldest first', async () => {
        const { repository } = await setup();

        for (const second of [1, 2, 3]) {
          await repository.appendEvent('2026-10', eventAt(second));
        }

        expect(await repository.listEvents('2026-10', { limit: 2 })).toEqual([
          eventAt(2),
          eventAt(3),
        ]);
        expect(await repository.listEvents('2026-11', { limit: 10 })).toEqual([]);
      });

      it(`keeps at most ${MAX_JOB_EVENTS} events`, async () => {
        const { repository } = await setup();

        await Promise.all(
          Array.from({ length: MAX_JOB_EVENTS + 5 }, (_, second) =>
            repository.appendEvent('2026-10', eventAt(second)),
          ),
        );

        expect(await repository.listEvents('2026-10', { limit: 1000 })).toHaveLength(
          MAX_JOB_EVENTS,
        );
      });

      it('refuses an event that fails its schema', async () => {
        const { repository } = await setup();

        await expect(repository.appendEvent('2026-10', eventAt(1, ''))).rejects.toMatchObject({
          code: 'STATE_SCHEMA_INVALID',
        });
      });
    });

    describe('markEmailConsumed', () => {
      it('gives an email to the first job, and again to the same job after a crash', async () => {
        const { repository } = await setup();

        expect(await repository.markEmailConsumed('19a2f0a1b2c3d4e5', '2026-10')).toEqual({
          ownerJobId: '2026-10',
        });
        expect(await repository.markEmailConsumed('19a2f0a1b2c3d4e5', '2026-10')).toEqual({
          ownerJobId: '2026-10',
        });
        expect(await repository.markEmailConsumed('19a2f0a1b2c3d4e5', '2026-10-r2')).toEqual({
          ownerJobId: '2026-10',
        });
      });

      it('gives an email to exactly one of 20 concurrent jobs', async () => {
        const { repository } = await setup();
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            repository.markEmailConsumed('19a2f0a1b2c3d4e6', `job-${index}`),
          ),
        );
        const owners = new Set(results.map((result) => result.ownerJobId));

        expect(owners.size).toBe(1);
      });
    });
  });
}
