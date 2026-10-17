import { describe, expect, it } from 'vitest';

import { requestCancel } from '../../src/domain/job-lifecycle.js';
import type { StepKind } from '../../src/domain/next-step.js';
import { LEASE_TTL_MS, leaseKindFor, nextStep } from '../../src/domain/next-step.js';
import type { JobStatus } from '../../src/domain/statuses.js';
import {
  attentionJob,
  clickedJob,
  hoursAfter,
  jobInStatus,
  minutesAfter,
  policy,
  triggeringJob,
} from '../support/jobs.js';

const now = minutesAfter(60);

describe('nextStep', () => {
  it.each([
    ['CREATED', 'begin_trigger'],
    ['TRIGGERING_EXPORT', 'trigger_export'],
    ['WAITING_FOR_EMAIL', 'check_email'],
    ['EMAIL_FOUND', 'transfer'],
    ['DOWNLOADING', 'rollback_orphan'],
    ['VERIFYING', 'rollback_orphan'],
    ['UPLOADING', 'rollback_orphan'],
    ['RETRYABLE_FAILURE', 'resume'],
    ['COMPLETE', 'noop'],
    ['FAILED', 'noop'],
    ['CANCELLED', 'noop'],
  ] as [JobStatus, StepKind][])('%s → %s', (status, kind) => {
    expect(nextStep(jobInStatus(status), now, policy).kind).toBe(kind);
  });

  it('never clicks twice: a saved click marker means in doubt', () => {
    expect(nextStep(triggeringJob(), now, policy)).toEqual({ kind: 'trigger_export' });
    expect(nextStep(clickedJob(), now, policy)).toEqual({ kind: 'await_email_in_doubt' });
  });

  it('supervises a pending incident, and polls nothing while waiting for a person', () => {
    expect(nextStep(attentionJob('NOTION_UI_CHANGED'), now, policy)).toEqual({ kind: 'supervise' });
    expect(nextStep(attentionJob('NOTION_SESSION_EXPIRED'), now, policy)).toEqual({
      kind: 'noop',
      reason: 'awaiting_user',
    });
  });

  it('reports terminal jobs as a no-op', () => {
    expect(nextStep(jobInStatus('COMPLETE'), now, policy)).toEqual({
      kind: 'noop',
      reason: 'terminal',
    });
  });

  it('honours cancellation first, then the lifetime, then orphan rollback', () => {
    const downloading = jobInStatus('DOWNLOADING');
    const late = hoursAfter(200);

    expect(nextStep(requestCancel(downloading, now), late, policy).kind).toBe('cancel');
    expect(nextStep(downloading, late, policy).kind).toBe('fail_lifetime');
    expect(nextStep(downloading, now, policy).kind).toBe('rollback_orphan');
  });

  it('fails an expired job in any non-terminal status', () => {
    expect(nextStep(attentionJob(), hoursAfter(168), policy).kind).toBe('fail_lifetime');
  });
});

describe('leaseKindFor', () => {
  it.each([
    ['trigger_export', 'heavy'],
    ['transfer', 'heavy'],
    ['supervise', 'heavy'],
    ['begin_trigger', 'light'],
    ['await_email_in_doubt', 'light'],
    ['check_email', 'light'],
    ['resume', 'light'],
    ['rollback_orphan', 'light'],
    ['cancel', 'light'],
    ['fail_lifetime', 'light'],
  ] as const)('%s needs a %s lease', (kind, lease) => {
    expect(leaseKindFor({ kind })).toBe(lease);
  });

  it('needs no lease for a no-op', () => {
    expect(leaseKindFor({ kind: 'noop', reason: 'terminal' })).toBeUndefined();
  });

  it('holds a light lease 60 s and a heavy one 330 s, past the 300 s function limit', () => {
    expect(LEASE_TTL_MS).toEqual({ heavy: 330_000, light: 60_000 });
  });
});
