import { describe, expect, it } from 'vitest';

import { InvalidTransitionError } from '../../src/domain/domain-errors.js';
import type { JobStatus } from '../../src/domain/statuses.js';
import { jobStatuses } from '../../src/domain/statuses.js';
import { canTransition, transition, update } from '../../src/domain/transitions.js';
import {
  attentionJob,
  jobInStatus,
  minutesAfter,
  retryableJob,
  triggeringJob,
} from '../support/jobs.js';

const fail = ['RETRYABLE_FAILURE', 'NEEDS_ATTENTION'] as const;
const end = ['CANCELLED', 'FAILED'] as const;

/**
 * The full transition table, written out independently of the implementation. Each row lists
 * every allowed target, including the in-place update (same status).
 */
const expected: Record<JobStatus, readonly JobStatus[]> = {
  CANCELLED: [],
  COMPLETE: [],
  CREATED: ['CREATED', 'TRIGGERING_EXPORT', ...fail, ...end],
  DOWNLOADING: ['DOWNLOADING', 'VERIFYING', 'EMAIL_FOUND', 'TRIGGERING_EXPORT', ...fail, ...end],
  EMAIL_FOUND: ['EMAIL_FOUND', 'DOWNLOADING', 'COMPLETE', 'TRIGGERING_EXPORT', ...fail, ...end],
  FAILED: [],
  NEEDS_ATTENTION: [
    'NEEDS_ATTENTION',
    'TRIGGERING_EXPORT',
    'WAITING_FOR_EMAIL',
    'EMAIL_FOUND',
    ...end,
  ],
  RETRYABLE_FAILURE: [
    'RETRYABLE_FAILURE',
    'TRIGGERING_EXPORT',
    'WAITING_FOR_EMAIL',
    'EMAIL_FOUND',
    ...end,
  ],
  TRIGGERING_EXPORT: ['TRIGGERING_EXPORT', 'WAITING_FOR_EMAIL', 'COMPLETE', ...fail, ...end],
  UPLOADING: ['UPLOADING', 'COMPLETE', 'EMAIL_FOUND', ...fail, ...end],
  VERIFYING: ['VERIFYING', 'UPLOADING', 'EMAIL_FOUND', 'TRIGGERING_EXPORT', ...fail, ...end],
  WAITING_FOR_EMAIL: ['WAITING_FOR_EMAIL', 'EMAIL_FOUND', 'TRIGGERING_EXPORT', ...fail, ...end],
};

const pairs = jobStatuses.flatMap((from) =>
  jobStatuses.map((to) => [from, to, expected[from].includes(to)] as const),
);

describe('canTransition', () => {
  it.each(pairs)('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it('never changes a terminal status, not even in place', () => {
    for (const status of ['COMPLETE', 'FAILED', 'CANCELLED'] as const) {
      expect(jobStatuses.filter((to) => canTransition(status, to))).toEqual([]);
    }
  });
});

describe('transition', () => {
  it('applies the changes and stamps updatedAt', () => {
    const now = minutesAfter(30);
    const next = transition(
      triggeringJob(),
      'WAITING_FOR_EMAIL',
      { requestedAt: now.toISOString() },
      now,
    );

    expect(next).toMatchObject({
      requestedAt: now.toISOString(),
      status: 'WAITING_FOR_EMAIL',
      updatedAt: now.toISOString(),
    });
  });

  it('throws on a disallowed edge and leaves the job unchanged', () => {
    const job = jobInStatus('COMPLETE');

    expect(() => transition(job, 'CREATED', {}, minutesAfter(30))).toThrow(InvalidTransitionError);
    expect(job.status).toBe('COMPLETE');
  });

  it('clears resumeFrom once the job is back in a working status', () => {
    const job = retryableJob();

    expect(job.resumeFrom).toBe('TRIGGERING_EXPORT');
    expect(transition(job, 'TRIGGERING_EXPORT', {}, minutesAfter(30)).resumeFrom).toBeUndefined();
  });

  it('keeps the incident while the job stays in its stage, and closes it in another stage', () => {
    const job = attentionJob('NOTION_UI_CHANGED');
    const back = transition(job, 'TRIGGERING_EXPORT', {}, minutesAfter(30));

    expect(back.incident?.code).toBe('NOTION_UI_CHANGED');
    expect(transition(back, 'WAITING_FOR_EMAIL', {}, minutesAfter(31)).incident).toBeUndefined();
  });

  it('keeps the incident on CANCELLED and FAILED, so the reason stays visible', () => {
    const job = attentionJob('NOTION_UI_CHANGED');

    expect(transition(job, 'CANCELLED', {}, minutesAfter(30)).incident).toBeDefined();
    expect(transition(job, 'FAILED', {}, minutesAfter(30)).incident).toBeDefined();
  });

  it('update changes fields without changing the status', () => {
    const next = update(
      triggeringJob(),
      { exportClickAt: minutesAfter(5).toISOString() },
      minutesAfter(5),
    );

    expect(next.status).toBe('TRIGGERING_EXPORT');
    expect(next.exportClickAt).toBe(minutesAfter(5).toISOString());
  });
});
