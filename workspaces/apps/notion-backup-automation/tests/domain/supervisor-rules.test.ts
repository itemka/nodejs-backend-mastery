import { describe, expect, it } from 'vitest';

import { MIN_NEW_ATTEMPT_AFTER_CLICK_MS } from '../../src/agent/limits.js';
import { InvalidJobStateError } from '../../src/domain/domain-errors.js';
import {
  handOverToUser,
  recordFailure,
  recordSupervisorDecision,
  replaceIncident,
  supervisorNewAttempt,
  supervisorRetryStage,
} from '../../src/domain/job-lifecycle.js';
import type { BackupJob } from '../../src/domain/job.js';
import {
  attentionJob,
  hoursAfter,
  minutesAfter,
  policy,
  triggeringJob,
  valid,
  waitingJob,
} from '../support/jobs.js';

function invalidState(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidJobStateError) {
      return error.reason;
    }

    throw error;
  }

  return undefined;
}

const emailTimeout = (): BackupJob =>
  valid(recordFailure(waitingJob(), minutesAfter(10), 'EMAIL_TIMEOUT', policy));

describe('recordFailure with what the step observed', () => {
  it('keeps the landmarks on the incident, and refreshes them when it reopens', () => {
    const first = valid(
      recordFailure(triggeringJob(), minutesAfter(3), 'NOTION_UI_CHANGED', policy, {
        uiLandmarks: ['heading:Settings', 'tab:General'],
      }),
    );
    const decided = valid(
      recordSupervisorDecision(
        first,
        minutesAfter(4),
        { action: 'retry_stage', outcome: 'retrying' },
        {
          notionSession: { checkedAt: minutesAfter(4).toISOString(), state: 'valid' },
        },
      ),
    );
    const retried = valid(supervisorRetryStage(decided, minutesAfter(4), policy));
    const again = valid(
      recordFailure(retried, minutesAfter(6), 'NOTION_UI_CHANGED', policy, {
        uiLandmarks: ['heading:Settings'],
      }),
    );

    expect(first.incident?.observations).toEqual({
      uiLandmarks: ['heading:Settings', 'tab:General'],
    });
    expect(again.incident).toMatchObject({
      decisions: [{ action: 'retry_stage' }],
      observations: { notionSession: { state: 'valid' }, uiLandmarks: ['heading:Settings'] },
      occurrences: 2,
      state: 'awaiting_supervisor',
    });
  });
});

describe('recordSupervisorDecision', () => {
  it('appends the decision and merges observations, counting the incident once', () => {
    const job = attentionJob('UNKNOWN_ERROR');
    const once = valid(
      recordSupervisorDecision(
        job,
        minutesAfter(4),
        { action: 'inspect_status', outcome: 'inspected' },
        {
          inspectedAt: minutesAfter(4).toISOString(),
        },
      ),
    );
    const twice = valid(
      recordSupervisorDecision(once, minutesAfter(5), {
        modelFailure: 'timeout',
        outcome: 'no_decision',
      }),
    );

    expect(twice.incident).toMatchObject({
      decisions: [
        { action: 'inspect_status', at: minutesAfter(4).toISOString(), outcome: 'inspected' },
        { at: minutesAfter(5).toISOString(), modelFailure: 'timeout', outcome: 'no_decision' },
      ],
      observations: { inspectedAt: minutesAfter(4).toISOString() },
    });
    expect(twice.supervisedIncidents).toBe(1);
    expect(twice.status).toBe('NEEDS_ATTENTION');
  });

  it('needs an incident', () => {
    expect(
      invalidState(() =>
        recordSupervisorDecision(waitingJob(), minutesAfter(4), { action: 'wait' }),
      ),
    ).toBe('UNEXPECTED_STATUS');
  });
});

describe('supervisorRetryStage', () => {
  it('returns to the stage with one more retry and keeps the incident open', () => {
    const retried = valid(
      supervisorRetryStage(attentionJob('UNKNOWN_ERROR'), minutesAfter(4), policy),
    );

    expect(retried).toMatchObject({
      incident: { code: 'UNKNOWN_ERROR', state: 'awaiting_supervisor' },
      stageRetries: { NOTION_TRIGGER: 1 },
      status: 'TRIGGERING_EXPORT',
    });
    expect(retried.resumeFrom).toBeUndefined();
  });

  it('refuses after the stage retries and after this attempt’s click', () => {
    const job = attentionJob('UNKNOWN_ERROR');

    expect(
      invalidState(() =>
        supervisorRetryStage(
          { ...job, stageRetries: { NOTION_TRIGGER: 3 } },
          minutesAfter(4),
          policy,
        ),
      ),
    ).toBe('STAGE_RETRIES_EXHAUSTED');
    expect(
      invalidState(() =>
        supervisorRetryStage(
          { ...job, exportClickAt: minutesAfter(2).toISOString() },
          minutesAfter(4),
          policy,
        ),
      ),
    ).toBe('EXPORT_ALREADY_CLICKED');
  });

  it('runs the email stage again after the click', () => {
    expect(valid(supervisorRetryStage(emailTimeout(), minutesAfter(11), policy)).status).toBe(
      'WAITING_FOR_EMAIL',
    );
  });
});

describe('supervisorNewAttempt', () => {
  it('starts the next export attempt; an incident of another stage closes', () => {
    const next = valid(
      supervisorNewAttempt(emailTimeout(), hoursAfter(3), policy, MIN_NEW_ATTEMPT_AFTER_CLICK_MS),
    );

    expect(next).toMatchObject({ exportAttempt: 2, status: 'TRIGGERING_EXPORT' });
    expect(next.incident).toBeUndefined();
    expect(next.exportClickAt).toBeUndefined();
  });

  it('refuses once no attempt is left', () => {
    expect(
      invalidState(() =>
        supervisorNewAttempt(
          { ...emailTimeout(), exportAttempt: 3 },
          hoursAfter(3),
          policy,
          MIN_NEW_ATTEMPT_AFTER_CLICK_MS,
        ),
      ),
    ).toBe('EXPORT_ATTEMPTS_EXHAUSTED');
  });

  // The action policy checked these when it planned; the rule checks them on the job it writes.
  it('refuses an attempt that requested no export, or within 2 h of its request', () => {
    expect(
      invalidState(() =>
        supervisorNewAttempt(
          attentionJob('UNKNOWN_ERROR'),
          hoursAfter(3),
          policy,
          MIN_NEW_ATTEMPT_AFTER_CLICK_MS,
        ),
      ),
    ).toBe('EXPORT_NOT_REQUESTED');
    // The export was requested at T0 + 2 min.
    expect(
      invalidState(() =>
        supervisorNewAttempt(emailTimeout(), hoursAfter(2), policy, MIN_NEW_ATTEMPT_AFTER_CLICK_MS),
      ),
    ).toBe('NEW_ATTEMPT_TOO_SOON');
  });
});

describe('replaceIncident', () => {
  it('turns the incident into a known code’s, with a fresh history and its own state', () => {
    const decided = valid(
      recordSupervisorDecision(attentionJob('UNKNOWN_ERROR'), minutesAfter(4), {
        action: 'check_notion_session',
      }),
    );
    const replaced = valid(replaceIncident(decided, minutesAfter(5), 'NOTION_SESSION_EXPIRED'));

    expect(replaced.incident).toEqual({
      code: 'NOTION_SESSION_EXPIRED',
      decisions: [],
      occurrences: 1,
      openedAt: minutesAfter(5).toISOString(),
      stage: 'NOTION_TRIGGER',
      state: 'awaiting_user',
    });
    expect(replaced.lastError?.code).toBe('NOTION_SESSION_EXPIRED');
    expect(replaced.resumeFrom).toBe('TRIGGERING_EXPORT');
  });
});

describe('handOverToUser with a supervisor summary', () => {
  it('keeps the summary with the incident', () => {
    expect(
      valid(handOverToUser(attentionJob('UNKNOWN_ERROR'), minutesAfter(4), 'Check the logs.'))
        .incident,
    ).toMatchObject({ state: 'awaiting_user', supervisorSummary: 'Check the logs.' });
  });
});
