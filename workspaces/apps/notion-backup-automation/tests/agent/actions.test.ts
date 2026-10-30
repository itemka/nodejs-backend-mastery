import { describe, expect, it } from 'vitest';

import type { PolicyInput } from '../../src/agent/actions.js';
import { allowedActions, refusal } from '../../src/agent/actions.js';
import type { AgentAction } from '../../src/agent/agent-model.js';
import { defaultAgentLimits } from '../../src/agent/limits.js';
import { recordFailure } from '../../src/domain/job-lifecycle.js';
import type { BackupJob } from '../../src/domain/job.js';
import { supervisedJob } from '../support/agent.js';
import {
  emailFoundJob,
  hoursAfter,
  minutesAfter,
  policy,
  valid,
  waitingJob,
} from '../support/jobs.js';

function input(job: BackupJob, now = minutesAfter(30)): PolicyInput {
  return { job, limits: defaultAgentLimits, now, policy };
}

function retryStage(stage: 'EMAIL_WAIT' | 'NOTION_TRIGGER'): AgentAction {
  return { action: 'retry_stage', stage };
}

function withObservations(job: BackupJob, observations: object): BackupJob {
  return { ...job, incident: { ...job.incident!, observations } };
}

const notionIncident = supervisedJob('UNKNOWN_ERROR');
const emailIncident = valid(
  recordFailure(waitingJob(), minutesAfter(10), 'EMAIL_UNRECOGNIZED', policy),
);
const transferIncident = valid(
  recordFailure(emailFoundJob(), minutesAfter(10), 'UNKNOWN_ERROR', policy),
);

describe('refusal (the action table’s preconditions)', () => {
  it('always allows notify_user', () => {
    const lastDecision = {
      ...notionIncident,
      incident: {
        ...notionIncident.incident!,
        decisions: Array.from({ length: 3 }, () => ({
          action: 'wait' as const,
          at: minutesAfter(4).toISOString(),
        })),
      },
    };

    expect(refusal({ action: 'notify_user', summary: 'x' }, input(lastDecision))).toBeUndefined();
    expect(refusal({ action: 'inspect_status' }, input(lastDecision))).toBe('last_decision');
  });

  it('inspects once per incident', () => {
    expect(refusal({ action: 'inspect_status' }, input(notionIncident))).toBeUndefined();
    expect(
      refusal(
        { action: 'inspect_status' },
        input(withObservations(notionIncident, { inspectedAt: minutesAfter(5).toISOString() })),
      ),
    ).toBe('already_inspected');
  });

  it('probes the session only in NOTION_TRIGGER, at most every 30 min', () => {
    const probed = withObservations(notionIncident, {
      notionSession: { checkedAt: minutesAfter(10).toISOString(), state: 'valid' },
    });
    const action: AgentAction = { action: 'check_notion_session' };

    expect(refusal(action, input(notionIncident))).toBeUndefined();
    expect(refusal(action, input(emailIncident))).toBe('wrong_stage');
    expect(refusal(action, input(probed, minutesAfter(39)))).toBe('probed_recently');
    expect(refusal(action, input(probed, minutesAfter(40)))).toBeUndefined();
  });

  it('searches Gmail again only in EMAIL_WAIT', () => {
    const action: AgentAction = { action: 'search_email_again', widenMinutes: 60 };

    expect(refusal(action, input(emailIncident))).toBeUndefined();
    expect(refusal(action, input(notionIncident))).toBe('wrong_stage');
    expect(refusal(action, input(transferIncident))).toBe('wrong_stage');
  });

  it('waits only within the job’s lifetime', () => {
    // The job was created at T0; its lifetime ends at T0 + 168 h.
    expect(
      refusal({ action: 'wait', minutes: 240 }, input(notionIncident, hoursAfter(163.9))),
    ).toBeUndefined();
    expect(refusal({ action: 'wait', minutes: 240 }, input(notionIncident, hoursAfter(164)))).toBe(
      'past_lifetime',
    );
    expect(
      refusal({ action: 'wait', minutes: 15 }, input(notionIncident, hoursAfter(164))),
    ).toBeUndefined();
    expect(
      refusal({ action: 'wait', minutes: 15 }, input(notionIncident, hoursAfter(167.75))),
    ).toBe('past_lifetime');
  });

  it('retries only the incident’s stage, within the stage retries, never after the click', () => {
    expect(refusal(retryStage('NOTION_TRIGGER'), input(notionIncident))).toBeUndefined();
    expect(refusal(retryStage('EMAIL_WAIT'), input(notionIncident))).toBe('stage_mismatch');
    expect(
      refusal(
        retryStage('NOTION_TRIGGER'),
        input({ ...notionIncident, stageRetries: { NOTION_TRIGGER: 3 } }),
      ),
    ).toBe('stage_retries_exhausted');
    expect(
      refusal(
        retryStage('NOTION_TRIGGER'),
        input({ ...notionIncident, exportClickAt: minutesAfter(2).toISOString() }),
      ),
    ).toBe('export_clicked');
    // After the click, the email stage may still run again.
    expect(refusal(retryStage('EMAIL_WAIT'), input(emailIncident))).toBeUndefined();
  });

  it('starts a new attempt only with attempts left and 2 h after the click', () => {
    // Nothing was requested in this attempt yet: retry_stage is the action for that.
    expect(refusal({ action: 'retry' }, input(notionIncident, hoursAfter(5)))).toBe(
      'not_requested',
    );
    expect(refusal({ action: 'retry' }, input(emailIncident, minutesAfter(121)))).toBe(
      'too_soon_after_click',
    );
    expect(refusal({ action: 'retry' }, input(emailIncident, minutesAfter(122)))).toBeUndefined();
    expect(
      refusal({ action: 'retry' }, input({ ...emailIncident, exportAttempt: 3 }, hoursAfter(5))),
    ).toBe('attempts_exhausted');
  });
});

describe('allowedActions', () => {
  it('lists the actions with an allowed form, per stage', () => {
    expect(allowedActions(input(notionIncident))).toEqual([
      'inspect_status',
      'check_notion_session',
      'wait',
      'retry_stage',
      'notify_user',
    ]);
    expect(allowedActions(input(emailIncident, hoursAfter(3)))).toEqual([
      'inspect_status',
      'search_email_again',
      'wait',
      'retry_stage',
      'retry',
      'notify_user',
    ]);
  });
});
