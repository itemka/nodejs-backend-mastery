import { describe, expect, it } from 'vitest';

import { NOOP_SUMMARY } from '../../src/adapters/llm/noop-agent-model.js';
import { AgentModelError } from '../../src/agent/agent-model.js';
import { defaultAgentLimits } from '../../src/agent/limits.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import type { AttentionNotification } from '../../src/application/ports.js';
import { errorCodes } from '../../src/domain/error-catalog.js';
import { errorCatalog } from '../../src/domain/error-catalog.js';
import { recordFailure } from '../../src/domain/job-lifecycle.js';
import type { BackupJob } from '../../src/domain/job.js';
import {
  decision,
  deliverSeeded,
  ScriptedAgentModel,
  SEEDED_TOKEN,
  seedJob,
  supervisedJob,
} from '../support/agent.js';
import type { BackupHarness, HarnessOptions } from '../support/backup-harness.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { hoursAfter, minutesAfter, policy, T0, valid, waitingJob } from '../support/jobs.js';

/** The right-to-left override: an invisible character a page or a model may send. */
const RLO = '\u202E';

const MINUTE = 60;
const supervisedCodes = errorCodes.filter((code) => errorCatalog[code].supervised);

function scripted(options: HarnessOptions = {}) {
  const model = new ScriptedAgentModel();
  const harness = backupHarness({ ...options, model });

  return { harness, model };
}

function delays(harness: BackupHarness): number[] {
  return harness.qstash.published.map(({ delaySec }) => delaySec);
}

function attentions(harness: BackupHarness): AttentionNotification[] {
  return harness.sent
    .filter(({ kind }) => kind === 'attention')
    .map(({ notification }) => notification as AttentionNotification);
}

async function incidentOf(harness: BackupHarness): Promise<BackupJob['incident']> {
  const job = await storedJob(harness, '2026-10');

  return job.incident;
}

async function summaryOf(harness: BackupHarness): Promise<string | undefined> {
  const incident = await incidentOf(harness);

  return incident?.supervisorSummary;
}

async function decisionsOf(harness: BackupHarness): Promise<unknown[] | undefined> {
  const incident = await incidentOf(harness);

  return incident?.decisions;
}

async function statusOf(harness: BackupHarness): Promise<string> {
  const job = await storedJob(harness, '2026-10');

  return job.status;
}

async function supervisorEvents(harness: BackupHarness, jobId = '2026-10'): Promise<string[]> {
  const events = await harness.memory.listEvents(jobId, { limit: 200 });

  return events.filter(({ type }) => type === 'supervisor').map(({ text }) => text);
}

/** Starts a job whose export fails with NOTION_UI_CHANGED, up to the incident's first wakeup. */
async function uiChangedIncident(harness: BackupHarness): Promise<void> {
  harness.trigger.script = [new IntegrationError('NOTION_UI_CHANGED')];
  await harness.service.start();
  await harness.qstash.deliverNext(harness.processJob);
  await harness.qstash.deliverNext(harness.processJob);
}

/** A job waiting for its email that ran out of export attempts (EMAIL_TIMEOUT). */
function emailTimeoutJob(): BackupJob {
  return valid({
    ...recordFailure(waitingJob(), minutesAfter(10), 'EMAIL_TIMEOUT', policy),
    schedule: { notBefore: minutesAfter(10).toISOString(), token: SEEDED_TOKEN },
  });
}

describe('Supervisor with provider none (Step 24 "Done when")', () => {
  it.each(supervisedCodes)(
    'hands a %s incident to you after exactly one decision, with no further wakeup',
    async (code) => {
      const harness = backupHarness();

      await seedJob(harness, supervisedJob(code));

      await expect(deliverSeeded(harness)).resolves.toMatchObject({
        outcome: 'done',
        status: 'NEEDS_ATTENTION',
        step: 'supervise',
      });

      const job = await storedJob(harness, '2026-10');

      expect(job.incident).toMatchObject({
        code,
        decisions: [{ action: 'notify_user', outcome: 'handed_over' }],
        state: 'awaiting_user',
        supervisorSummary: NOOP_SUMMARY,
      });
      expect(job.supervisedIncidents).toBe(1);
      expect(job.schedule).toBeUndefined();
      expect(harness.qstash.published).toEqual([]);
      expect(attentions(harness)).toEqual([
        expect.objectContaining({ code, supervisorSummary: NOOP_SUMMARY }),
      ]);
    },
  );

  it('covers every supervised code of the catalog', () => {
    expect(supervisedCodes).toHaveLength(15);
  });

  it('runs end to end: the incident wakes once after 1 min, then goes to you', async () => {
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
    expect(await supervisorEvents(harness)).toEqual([
      'supervisor · notify_user → handed_over (none, high confidence) · No supervisor model is configured.',
    ]);
  });
});

describe('Supervisor with a scripted model', () => {
  it('runs one action per wakeup and re-evaluates with each outcome', async () => {
    const { harness, model } = scripted();

    model.script = [
      decision('inspect_status'),
      decision('wait', { minutes: 15 }),
      decision('notify_user', { summary: 'The Settings page changed; update the page object.' }),
    ];
    await uiChangedIncident(harness);
    await harness.qstash.deliverNext(harness.processJob);

    let job = await storedJob(harness, '2026-10');

    expect(job.incident).toMatchObject({
      decisions: [{ action: 'inspect_status', outcome: 'inspected' }],
      state: 'awaiting_supervisor',
    });
    expect(job.incident?.observations?.inspectedAt).toBeDefined();
    expect(delays(harness)).toEqual([0, 0, MINUTE, MINUTE]);

    await harness.qstash.deliverNext(harness.processJob);
    expect(delays(harness).at(-1)).toBe(15 * MINUTE);

    await harness.qstash.deliverNext(harness.processJob);
    job = await storedJob(harness, '2026-10');

    expect(job.incident).toMatchObject({
      decisions: [
        { action: 'inspect_status' },
        { action: 'wait', outcome: 'wait:15m' },
        { action: 'notify_user' },
      ],
      state: 'awaiting_user',
      supervisorSummary: 'The Settings page changed; update the page object.',
    });
    expect(harness.qstash.pendingCount()).toBe(0);
    expect(model.contexts.map(({ incident }) => incident.decisions.length)).toEqual([0, 1, 2]);
    expect(model.contexts.map(({ incident }) => incident.decisionsRemaining)).toEqual([4, 3, 2]);
    // inspect_status adds the events and the health results to the next contexts only.
    expect(model.contexts[0]?.observations.recentEvents).toBeUndefined();
    expect(model.contexts[1]?.observations.recentEvents?.length).toBeGreaterThan(0);
    expect(model.contexts[1]?.observations.health).toEqual({});
    expect(model.contexts[1]?.allowedActions).not.toContain('inspect_status');
    expect(attentions(harness)).toEqual([
      expect.objectContaining({
        code: 'NOTION_UI_CHANGED',
        supervisorSummary: 'The Settings page changed; update the page object.',
      }),
    ]);
    expect(await supervisorEvents(harness)).toHaveLength(3);
  });

  it('retries the stage; the same failure reopens the incident with its decisions', async () => {
    const { harness, model } = scripted();

    harness.trigger.script = [
      new IntegrationError('NOTION_UI_CHANGED'),
      new IntegrationError('NOTION_UI_CHANGED'),
    ];
    model.script = [decision('retry_stage', { stage: 'NOTION_TRIGGER' })];
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job).toMatchObject({
      incident: {
        code: 'NOTION_UI_CHANGED',
        decisions: [
          { action: 'retry_stage', outcome: 'retrying' },
          { action: 'notify_user', outcome: 'handed_over' },
        ],
        occurrences: 2,
        state: 'awaiting_user',
      },
      stageRetries: { NOTION_TRIGGER: 1 },
      status: 'NEEDS_ATTENTION',
      supervisedIncidents: 1,
    });
    expect(model.contexts[1]?.incident).toMatchObject({
      decisions: [{ action: 'retry_stage', outcome: 'retrying' }],
      decisionsRemaining: 3,
      occurrences: 2,
    });
    expect(harness.trigger.clicks).toEqual([]);
    expect(attentions(harness)).toHaveLength(1);
  });

  it('closes the incident once a retried stage succeeds, and the backup completes', async () => {
    const { harness, model } = scripted();

    harness.trigger.script = [new IntegrationError('NOTION_UI_CHANGED')];
    model.script = [decision('retry_stage', { stage: 'NOTION_TRIGGER' })];
    await harness.service.start();
    await harness.drain();

    const job = await storedJob(harness, '2026-10');

    expect(job.status).toBe('COMPLETE');
    expect(job.incident).toBeUndefined();
    expect(harness.trigger.clicks).toHaveLength(1);
  });

  it('refuses retry_stage after this attempt clicked Export, and hands over', async () => {
    const { harness, model } = scripted();

    model.script = [decision('retry_stage', { stage: 'NOTION_TRIGGER' })];
    await seedJob(
      harness,
      supervisedJob('UNKNOWN_ERROR', { exportClickAt: minutesAfter(2).toISOString() }),
    );
    await deliverSeeded(harness);

    const job = await storedJob(harness, '2026-10');

    expect(model.contexts[0]?.allowedActions).not.toContain('retry_stage');
    expect(job.status).toBe('NEEDS_ATTENTION');
    expect(job.incident).toMatchObject({
      decisions: [{ action: 'notify_user', outcome: 'forced:policy' }],
      state: 'awaiting_user',
    });
    expect(job.incident?.supervisorSummary).toContain(
      'The supervisor proposed retry_stage, which is not allowed now (export_clicked).',
    );
    expect(harness.trigger.clicks).toEqual([]);
  });

  it.each([
    [
      'search_email_again outside EMAIL_WAIT',
      decision('search_email_again', { widenMinutes: 60 }),
      'wrong_stage',
    ],
    [
      'retry_stage of another stage',
      decision('retry_stage', { stage: 'TRANSFER' }),
      'stage_mismatch',
    ],
    ['retry with no export attempt left', decision('retry'), 'attempts_exhausted'],
  ] as const)('turns %s into notify_user', async (_name, chosen, refused) => {
    const { harness, model } = scripted();

    model.script = [chosen];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR', { exportAttempt: 3 }));
    await deliverSeeded(harness);

    expect(await summaryOf(harness)).toContain(`not allowed now (${refused})`);
  });

  it('counts an invalid answer, asks again, and hands over after the second failure', async () => {
    const { harness, model } = scripted();

    model.script = [
      { action: 'retry_stage', confidence: 'high', params: {}, rationale: 'no stage given' },
      new AgentModelError('rate_limited', 'Gemini answered 429', 429),
    ];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);

    let job = await storedJob(harness, '2026-10');

    expect(job.incident).toMatchObject({
      decisions: [{ modelFailure: 'invalid_output', outcome: 'no_decision' }],
      state: 'awaiting_supervisor',
    });
    expect(job.incident?.decisions[0]?.action).toBeUndefined();
    expect(delays(harness)).toEqual([MINUTE]);

    await harness.qstash.deliverNext(harness.processJob);
    job = await storedJob(harness, '2026-10');

    expect(job.incident).toMatchObject({
      decisions: [
        { modelFailure: 'invalid_output' },
        { action: 'notify_user', modelFailure: 'rate_limited', outcome: 'forced:model_failures' },
      ],
      state: 'awaiting_user',
      supervisorSummary:
        'The supervisor model was rate-limited twice, so this incident goes to you without triage.',
    });
    expect(model.contexts[1]?.incident.decisions).toEqual([{ outcome: 'model_invalid_output' }]);
    expect(harness.qstash.pendingCount()).toBe(0);
  });

  it('counts a model that does not answer within AGENT_TIMEOUT_MS as a timeout', async () => {
    const { harness, model } = scripted({ agentLimits: { ...defaultAgentLimits, timeoutMs: 20 } });

    model.script = ['hang', 'hang'];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);
    await harness.qstash.deliverNext(harness.processJob);

    expect(await incidentOf(harness)).toMatchObject({
      decisions: [{ modelFailure: 'timeout' }, { action: 'notify_user', modelFailure: 'timeout' }],
      state: 'awaiting_user',
    });
  });

  it('allows only notify_user as the incident’s last decision', async () => {
    const { harness, model } = scripted({
      agentLimits: { ...defaultAgentLimits, maxDecisionsPerIncident: 2 },
    });

    model.script = [decision('inspect_status'), decision('wait', { minutes: 15 })];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);
    await harness.qstash.deliverNext(harness.processJob);

    expect(model.contexts[1]?.allowedActions).toEqual(['notify_user']);
    expect(await incidentOf(harness)).toMatchObject({
      decisions: [
        { action: 'inspect_status' },
        { action: 'notify_user', outcome: 'forced:policy' },
      ],
      state: 'awaiting_user',
    });
  });

  it('hands over without a model call once the incident used its decisions', async () => {
    const { harness, model } = scripted();
    const old = minutesAfter(4).toISOString();
    const job = supervisedJob('UNKNOWN_ERROR');

    await seedJob(harness, {
      ...job,
      incident: {
        ...job.incident!,
        decisions: Array.from({ length: 4 }, () => ({ action: 'wait' as const, at: old })),
      },
    });
    harness.clock.advance(60 * 60_000);
    await deliverSeeded(harness);

    expect(model.contexts).toEqual([]);
    expect(await incidentOf(harness)).toMatchObject({
      state: 'awaiting_user',
      supervisorSummary: 'The supervisor used its 4 decisions on this incident without a fix.',
    });
  });

  it('sends a job’s fourth incident straight to you (AGENT_MAX_INCIDENTS_PER_JOB)', async () => {
    const { harness, model } = scripted();

    await seedJob(harness, supervisedJob('UNKNOWN_ERROR', { supervisedIncidents: 3 }));
    await deliverSeeded(harness);

    expect(model.contexts).toEqual([]);
    expect(await incidentOf(harness)).toMatchObject({
      decisions: [{ action: 'notify_user', outcome: 'forced:incident_budget' }],
      state: 'awaiting_user',
    });
  });

  it('stops calling the model once the daily decisions are used up', async () => {
    const { harness, model } = scripted({
      agentLimits: { ...defaultAgentLimits, maxDecisionsPerDay: 1 },
    });

    await harness.limiter.take('agent:decisions', { limit: 1, windowSec: 86_400 });
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);

    expect(model.contexts).toEqual([]);
    expect(await decisionsOf(harness)).toEqual([
      expect.objectContaining({ action: 'notify_user', outcome: 'forced:daily_budget' }),
    ]);
  });

  it('decides at most once a minute, even when woken early', async () => {
    const { harness, model } = scripted();

    model.script = [decision('inspect_status')];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);
    harness.clock.advance(20_000);
    await harness.service.process('2026-10');
    await harness.qstash.deliverNext(harness.processJob);

    expect(model.contexts).toHaveLength(1);
    expect(delays(harness)).toEqual([MINUTE, 0, 40]);
  });

  it('keeps a chosen wait when its wakeup is not published: the redelivery decides nothing', async () => {
    const { harness, model } = scripted();

    model.script = [decision('wait', { minutes: 240 })];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    harness.qstash.publishFailures = 1;

    const decidedAt = harness.clock.now().getTime();

    await expect(deliverSeeded(harness)).rejects.toThrow('QStash unavailable');

    // QStash retries the same delivery, whose token is still the stored one.
    harness.clock.advance(MINUTE * 1000);
    await deliverSeeded(harness);

    expect(model.contexts).toHaveLength(1);
    expect(await decisionsOf(harness)).toEqual([
      expect.objectContaining({
        action: 'wait',
        outcome: 'wait:240m',
        waitUntil: new Date(decidedAt + 240 * MINUTE * 1000).toISOString(),
      }),
    ]);
    expect(delays(harness)).toEqual([239 * MINUTE]);
  });

  it('checks the Notion session and records what it found', async () => {
    const { harness, model } = scripted();

    model.script = [decision('check_notion_session')];
    await seedJob(harness, supervisedJob('BROWSER_LAUNCH_FAILED'));
    await deliverSeeded(harness);
    await harness.qstash.deliverNext(harness.processJob);

    const job = await storedJob(harness, '2026-10');

    expect(harness.trigger.probes).toBe(1);
    expect(harness.trigger.clicks).toEqual([]);
    expect(job.incident?.observations?.notionSession?.state).toBe('valid');
    expect(job.incident?.decisions[0]?.outcome).toBe('session:valid');
    expect(model.contexts[1]?.observations.notionSession).toBe('valid');
    expect(model.contexts[1]?.allowedActions).not.toContain('check_notion_session');
  });

  it('turns an expired session found by the probe into a login incident for you', async () => {
    const { harness, model } = scripted();

    model.script = [decision('check_notion_session')];
    harness.trigger.probeFailures = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);

    const job = await storedJob(harness, '2026-10');

    expect(job.incident).toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
      decisions: [],
      occurrences: 1,
      state: 'awaiting_user',
    });
    expect(job.lastError?.code).toBe('NOTION_SESSION_EXPIRED');
    expect(harness.qstash.published).toEqual([]);
    expect(attentions(harness)).toEqual([
      expect.objectContaining({ code: 'NOTION_SESSION_EXPIRED' }),
    ]);
  });

  it('searches Gmail again from earlier and keeps only counts', async () => {
    const { harness, model } = scripted();
    const job = emailTimeoutJob();

    model.script = [decision('search_email_again', { widenMinutes: 180 })];
    harness.emails.arrived.push({
      messageId: 'early0001',
      receivedAtMs: Date.parse(job.requestedAt!) - 2 * 60 * 60_000,
    });
    await seedJob(harness, job);
    await deliverSeeded(harness);
    await harness.qstash.deliverNext(harness.processJob);

    const stored = await storedJob(harness, '2026-10');

    expect(harness.emails.searches[0]?.requestedAfter.toISOString()).toBe(
      new Date(Date.parse(job.requestedAt!) - 180 * 60_000).toISOString(),
    );
    expect(stored.status).toBe('NEEDS_ATTENTION');
    expect(stored.emailMessageId).toBeUndefined();
    expect(stored.incident?.observations?.emailSearch).toMatchObject({
      candidates: 1,
      rejected: {},
      widenMinutes: 180,
    });
    expect(model.contexts[1]?.observations.emailSearch).toEqual({
      candidates: 1,
      rejected: {},
      widenMinutes: 180,
    });
    expect(JSON.stringify(model.contexts[1])).not.toContain('early0001');
  });

  it('starts a new export attempt with retry, and the backup completes', async () => {
    const { harness, model } = scripted({ start: hoursAfter(3).toISOString() });

    model.script = [decision('retry')];
    await seedJob(harness, emailTimeoutJob());
    await deliverSeeded(harness);

    expect(await storedJob(harness, '2026-10')).toMatchObject({
      exportAttempt: 2,
      status: 'TRIGGERING_EXPORT',
    });
    expect(await incidentOf(harness)).toBeUndefined();

    await harness.drain();

    expect(await statusOf(harness)).toBe('COMPLETE');
    expect(harness.trigger.clicks).toHaveLength(1);
  });

  it('never waits past the job’s lifetime', async () => {
    const { harness, model } = scripted({ start: hoursAfter(167.9).toISOString() });

    model.script = [decision('wait', { minutes: 15 })];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);

    expect(model.contexts[0]?.allowedActions).not.toContain('wait');
    expect(await summaryOf(harness)).toContain('(past_lifetime)');
  });

  it('cleans the model’s text before it is stored, sent or shown', async () => {
    const { harness, model } = scripted();

    model.script = [
      {
        action: 'notify_user',
        confidence: 'low',
        params: {
          summary: `Open https://evil.example/login?token=abc and mail owner@example.com; Bearer ya29.secret-token${RLO} ${'x'.repeat(600)}`,
        },
        rationale: 'See https://evil.example/?q=1 from someone@example.org',
      },
    ];
    await seedJob(harness, supervisedJob('UNKNOWN_ERROR'));
    await deliverSeeded(harness);

    const job = await storedJob(harness, '2026-10');
    const stored = JSON.stringify([job, await supervisorEvents(harness), harness.sent]);

    expect(job.incident?.supervisorSummary?.length).toBeLessThanOrEqual(400);
    expect(job.incident?.supervisorSummary).toContain('[link]');

    for (const secret of [
      'evil.example',
      'owner@example.com',
      'someone@example.org',
      'ya29.',
      RLO,
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it('keeps the incident open while a cancel request is honoured first', async () => {
    const { harness, model } = scripted();

    await seedJob(harness, supervisedJob('UNKNOWN_ERROR', { cancelRequestedAt: T0.toISOString() }));
    await deliverSeeded(harness);

    expect(model.contexts).toEqual([]);
    expect(await statusOf(harness)).toBe('CANCELLED');
  });
});
