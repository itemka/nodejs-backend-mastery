import { describe, expect, it } from 'vitest';

import type { BackupJob } from '../../src/domain/job.js';
import { backupJobSchema, newBackupJob, stageOf } from '../../src/domain/job.js';
import {
  attentionJob,
  emailFoundJob,
  jobInStatus,
  retryableJob,
  T0,
  waitingJob,
} from '../support/jobs.js';

function issuePaths(job: unknown): string[] {
  const result = backupJobSchema.safeParse(job);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('newBackupJob', () => {
  it('creates a CREATED job on attempt 1', () => {
    expect(newBackupJob({ kind: 'scheduled', now: T0, period: '2026-10' })).toEqual({
      createdAt: T0.toISOString(),
      emailCheckAttempt: 0,
      exportAttempt: 1,
      id: '2026-10',
      kind: 'scheduled',
      period: '2026-10',
      schemaVersion: 1,
      stageRetries: {},
      status: 'CREATED',
      transferAttempt: 0,
      updatedAt: T0.toISOString(),
    });
  });

  it('names a forced job by its revision', () => {
    expect(newBackupJob({ kind: 'forced', now: T0, period: '2026-10', revision: 3 }).id).toBe(
      '2026-10-r3',
    );
  });
});

describe('backupJobSchema', () => {
  it('survives a JSON round trip', () => {
    const job = emailFoundJob();
    const stored = JSON.stringify(job);

    expect(backupJobSchema.parse(JSON.parse(stored))).toEqual(job);
  });

  it.each([
    ['a normal ID that differs from the period', { id: '2026-11' }, ['id']],
    ['a forced kind without a revision', { kind: 'forced' }, ['id']],
    ['a revision on a normal kind', { id: '2026-10-r2' }, ['id']],
    ['an unknown schema version', { schemaVersion: 2 }, ['schemaVersion']],
    ['an unknown status', { status: 'PAUSED' }, ['status']],
    ['a non-UTC timestamp', { createdAt: '2026-10-01T06:00:00+02:00' }, ['createdAt']],
  ] as [string, Partial<BackupJob> | Record<string, unknown>, string[]][])(
    'rejects %s',
    (_case, change, paths) => {
      expect(issuePaths({ ...jobInStatus('CREATED'), ...change })).toEqual(paths);
    },
  );

  it.each([
    ['RETRYABLE_FAILURE', retryableJob, ['resumeFrom', 'lastError']],
    ['NEEDS_ATTENTION', () => attentionJob(), ['resumeFrom', 'lastError', 'incident']],
    ['WAITING_FOR_EMAIL', waitingJob, ['requestedAt']],
    ['EMAIL_FOUND', emailFoundJob, ['requestedAt', 'emailMessageId']],
    ['COMPLETE', () => jobInStatus('COMPLETE'), ['result', 'completedAt']],
  ] as const)('requires the fields of %s', (_status, build, fields) => {
    const job: Record<string, unknown> = { ...build() };

    for (const field of fields) {
      delete job[field];
    }

    expect(issuePaths(job)).toEqual(fields);
  });
});

describe('stageOf', () => {
  it.each([
    ['CREATED', 'NOTION_TRIGGER'],
    ['TRIGGERING_EXPORT', 'NOTION_TRIGGER'],
    ['WAITING_FOR_EMAIL', 'EMAIL_WAIT'],
    ['EMAIL_FOUND', 'TRANSFER'],
    ['UPLOADING', 'TRANSFER'],
    ['RETRYABLE_FAILURE', 'NOTION_TRIGGER'],
    ['NEEDS_ATTENTION', 'NOTION_TRIGGER'],
    ['COMPLETE', undefined],
  ] as const)('%s → %s', (status, stage) => {
    expect(stageOf(jobInStatus(status))).toBe(stage);
  });
});
