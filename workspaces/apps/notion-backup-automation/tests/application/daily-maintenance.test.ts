import { describe, expect, it } from 'vitest';

import type { ProbeName } from '../../src/application/daily-maintenance.js';
import {
  DailyMaintenance,
  isStuck,
  STUCK_AFTER_MS,
} from '../../src/application/daily-maintenance.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import { LoginWarnings } from '../../src/application/login-watch.js';
import type { HealthProbes, Heartbeat } from '../../src/application/ports.js';
import type { ErrorCode } from '../../src/domain/error-catalog.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { TEST_TOKEN } from '../support/fixture-secrets.js';
import { attentionJob, hoursAfter, waitingJob } from '../support/jobs.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 2026-10-07 is a Wednesday; the harness starts on 2026-10-01 (Thursday) 06:00 Warsaw. */
const WEDNESDAY = '2026-10-07T04:00:00.000Z';
const MONDAY = '2026-10-12T04:00:00.000Z';

type ProbeScript = Partial<Record<ProbeName, ErrorCode | Error>>;

/** The probes the cron runs, scripted: a pass, or a failure with a code. */
function fakeProbes(script: ProbeScript, calls: ProbeName[]): HealthProbes {
  const run = <T>(name: ProbeName, result: T): Promise<T> => {
    calls.push(name);

    const failure = script[name];

    if (failure instanceof Error) {
      return Promise.reject(failure);
    }

    return failure === undefined
      ? Promise.resolve(result)
      : Promise.reject(new IntegrationError(failure));
  };

  return {
    drive: () => run('drive', { mode: 'existing' as const }),
    google: () => run('google', { scopes: ['gmail.readonly', 'drive.file'] }),
    notion: () =>
      run('notion', {
        authCookieExpiresAt: '2027-10-01T00:00:00.000Z',
        exportDialog: 'ready' as const,
      }),
  };
}

interface SetupOptions {
  autoStart?: boolean;
  dayOfMonth?: number;
  heartbeatThrows?: boolean;
  notionExpiresAt?: string;
  probeOverrides?: Partial<HealthProbes>;
  probes?: ProbeScript;
  start?: string;
}

function setup(options: SetupOptions = {}) {
  const harness = backupHarness({ start: options.start ?? WEDNESDAY });
  const probeCalls: ProbeName[] = [];
  const beats: string[] = [];
  const probes: ProbeScript = { ...options.probes };
  const heartbeat: Heartbeat = {
    fail: () => {
      beats.push('fail');

      return options.heartbeatThrows === true
        ? Promise.reject(new Error('ping'))
        : Promise.resolve();
    },
    ok: () => {
      beats.push('ok');

      return options.heartbeatThrows === true
        ? Promise.reject(new Error('ping'))
        : Promise.resolve();
    },
  };
  const maintenance = new DailyMaintenance({
    autoStart: { dayOfMonth: options.dayOfMonth ?? 1, enabled: options.autoStart ?? false },
    clock: harness.clock,
    health: harness.health,
    heartbeat,
    jobs: harness.jobs,
    logger: harness.logger,
    notionLogin: { authCookieExpiresAt: () => Promise.resolve(options.notionExpiresAt) },
    policy: harness.policy,
    probes: { ...fakeProbes(probes, probeCalls), ...options.probeOverrides },
    service: harness.service,
    timeZone: 'Europe/Warsaw',
    warnings: new LoginWarnings({
      clock: harness.clock,
      gate: harness.gate,
      logger: harness.logger,
      notifications: harness.notifications,
      warningDays: [30, 7, 1],
    }),
  });

  return { beats, harness, maintenance, probeCalls, probes };
}

/** A started job that ends up waiting for you with `code`, and nothing pending in QStash. */
async function waitingFor(harness: ReturnType<typeof backupHarness>, code: ErrorCode) {
  if (code.startsWith('NOTION_')) {
    harness.trigger.script = [new IntegrationError(code)];
  } else {
    harness.emails.failures = [new IntegrationError(code)];
  }

  await harness.service.start();
  await harness.drain();

  const job = await storedJob(harness, '2026-10');

  expect(job).toMatchObject({
    incident: { code, state: 'awaiting_user' },
    status: 'NEEDS_ATTENTION',
  });
  expect(harness.qstash.pendingCount()).toBe(0);

  return job;
}

function loginWarnings(harness: ReturnType<typeof backupHarness>) {
  return harness.sent
    .filter((record) => record.kind === 'loginWarning')
    .map((record) => record.notification);
}

describe('DailyMaintenance.run', () => {
  it('on an idle system: one heartbeat, the daily probes, and nothing published', async () => {
    const { beats, harness, maintenance, probeCalls } = setup();

    const report = await maintenance.run();

    expect(report).toEqual({
      autoStart: 'disabled',
      failedSteps: [],
      ok: true,
      probes: { drive: 'ok', google: 'ok' },
      resumed: [],
      watchdog: 'idle',
    });
    expect(beats).toEqual(['ok']);
    expect(probeCalls).toEqual(['google', 'drive']);
    expect(harness.qstash.published).toEqual([]);
    await expect(harness.health.read()).resolves.toMatchObject({
      cron: { ok: true, ranAt: WEDNESDAY },
      driveRoot: { checkedAt: WEDNESDAY, mode: 'existing', ok: true },
      google: { checkedAt: WEDNESDAY, scopes: ['gmail.readonly', 'drive.file'], tokenOk: true },
    });
  });

  it('runs the due probes at once, so the slowest budget bounds the run', async () => {
    let started = 0;
    const allStarted = Promise.withResolvers<void>();

    // Each probe waits until both have started: one after the other, neither would finish.
    const held = async <T>(result: T): Promise<T> => {
      started += 1;

      if (started === 2) {
        allStarted.resolve();
      }

      await allStarted.promise;

      return result;
    };

    const { maintenance } = setup({
      probeOverrides: {
        drive: () => held({ mode: 'existing' as const }),
        google: () => held({ scopes: ['gmail.readonly', 'drive.file'] }),
      },
    });

    await expect(maintenance.run()).resolves.toMatchObject({
      failedSteps: [],
      probes: { drive: 'ok', google: 'ok' },
    });
    expect(started).toBe(2);
  });

  it('never creates a job while AUTO_START_ENABLED is false, even when due', async () => {
    const { harness, maintenance } = setup({ autoStart: false, dayOfMonth: 1 });

    await expect(maintenance.run()).resolves.toMatchObject({ autoStart: 'disabled' });
    await expect(harness.memory.list({ limit: 1 })).resolves.toEqual([]);
  });

  it('auto-starts the period once when due, idle and enabled', async () => {
    const { harness, maintenance } = setup({ autoStart: true, dayOfMonth: 1 });

    await expect(maintenance.run()).resolves.toMatchObject({ autoStart: 'started' });
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      kind: 'scheduled',
      status: 'CREATED',
    });
    expect(harness.qstash.published).toEqual([
      expect.objectContaining({ delaySec: 0, jobId: '2026-10', reason: 'start' }),
    ]);

    // The next day the job is active; a day after it ended, the period's job exists.
    harness.clock.advance(DAY_MS);
    await expect(maintenance.run()).resolves.toMatchObject({ autoStart: 'active_job' });
    await harness.drain();
    harness.clock.advance(DAY_MS);
    await expect(maintenance.run()).resolves.toMatchObject({ autoStart: 'exists' });
    await expect(harness.memory.list({ limit: 10 })).resolves.toHaveLength(1);
  });

  it('does not auto-start before the backup day', async () => {
    const { harness, maintenance } = setup({ autoStart: true, dayOfMonth: 20 });

    await expect(maintenance.run()).resolves.toMatchObject({ autoStart: 'not_due' });
    expect(harness.qstash.published).toEqual([]);
  });

  it('re-arms a job whose wakeup was lost, through the control lease, and leaves an on-time one alone', async () => {
    const { harness, maintenance } = setup();

    await harness.service.start();
    await harness.qstash.deliverNext(harness.processJob); // CREATED → TRIGGERING_EXPORT
    // The immediate wakeup for the trigger is lost.
    await harness.qstash.cancel(harness.qstash.published.at(-1)?.messageId ?? '');

    await expect(maintenance.run()).resolves.toMatchObject({ watchdog: 'on_schedule' });
    expect(harness.qstash.published).toHaveLength(2);

    harness.clock.advance(STUCK_AFTER_MS + 1);
    await expect(maintenance.run()).resolves.toMatchObject({ watchdog: 'rearmed' });
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'watchdog' });

    await harness.drain();
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'COMPLETE' });
  });

  it('reports a job a worker holds instead of re-arming it', async () => {
    const { harness, maintenance } = setup();

    await harness.service.start();
    harness.clock.advance(STUCK_AFTER_MS + 1);
    await harness.memory.acquireLease('2026-10', 'worker', 300_000);

    await expect(maintenance.run()).resolves.toMatchObject({ watchdog: 'leased' });
    expect(harness.qstash.published).toHaveLength(1);
  });

  it('wakes a job past its lifetime, and the tick ends it as FAILED with a failure notification', async () => {
    const { harness, maintenance } = setup();

    await waitingFor(harness, 'NOTION_UI_CHANGED');
    harness.clock.advance(169 * HOUR_MS);

    await expect(maintenance.run()).resolves.toMatchObject({ watchdog: 'lifetime' });
    expect(harness.qstash.published.at(-1)).toMatchObject({ reason: 'watchdog' });

    await harness.drain();
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      lastError: { code: 'JOB_LIFETIME_EXCEEDED' },
      status: 'FAILED',
    });
    expect(harness.sent.filter((record) => record.kind === 'failure')).toHaveLength(1);
  });

  it('never polls a job that waits for you', async () => {
    const { harness, maintenance } = setup();

    await waitingFor(harness, 'NOTION_UI_CHANGED');

    const published = harness.qstash.published.length;

    for (let day = 0; day < 3; day += 1) {
      harness.clock.advance(DAY_MS);
      await expect(maintenance.run()).resolves.toMatchObject({ watchdog: 'on_schedule' });
    }

    expect(harness.qstash.published).toHaveLength(published);
  });

  it('runs the Notion probe on Mondays and two days before the backup day only', async () => {
    const monday = setup({ start: MONDAY });

    await monday.maintenance.run();
    expect(monday.probeCalls).toEqual(['google', 'drive', 'notion']);
    await expect(monday.harness.health.read()).resolves.toMatchObject({
      notionSession: { checkedAt: MONDAY, exportDialog: 'ready', state: 'valid' },
    });

    // 2026-10-08, a Thursday, is two days before the 10th.
    const twoDaysBefore = setup({ dayOfMonth: 10, start: '2026-10-08T04:00:00.000Z' });

    await twoDaysBefore.maintenance.run();
    expect(twoDaysBefore.probeCalls).toContain('notion');

    const plain = setup({ dayOfMonth: 1, start: WEDNESDAY });

    await plain.maintenance.run();
    expect(plain.probeCalls).not.toContain('notion');
  });

  it('resumes a job waiting for Google once the Google probe passes, without backup_retry', async () => {
    const { harness, maintenance } = setup();

    await waitingFor(harness, 'GOOGLE_AUTH_REQUIRED');

    const report = await maintenance.run();

    expect(report).toMatchObject({ probes: { drive: 'ok', google: 'ok' }, resumed: ['2026-10'] });
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'retry' });

    await harness.drain();
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'COMPLETE' });
  });

  it('runs the Notion probe for a job waiting on the Notion login, and resumes it', async () => {
    const { harness, maintenance, probeCalls } = setup();

    await waitingFor(harness, 'NOTION_SESSION_EXPIRED');

    await expect(maintenance.run()).resolves.toMatchObject({ resumed: ['2026-10'] });
    expect(probeCalls).toContain('notion');
  });

  it('leaves a newer login incident alone when it replaces the waiting one during the probe', async () => {
    let publishedAfterReplacement = 0;
    const { harness, maintenance } = setup({
      probeOverrides: {
        notion: async () => {
          harness.clock.advance(60_000);
          harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
          await harness.service.retry('2026-10');
          await harness.drain();
          publishedAfterReplacement = harness.qstash.published.length;

          return { exportDialog: 'ready' };
        },
      },
    });
    const original = await waitingFor(harness, 'NOTION_SESSION_EXPIRED');

    await expect(maintenance.run()).resolves.toMatchObject({ resumed: [] });

    const waiting = await storedJob(harness, '2026-10');

    expect(waiting).toMatchObject({
      incident: {
        code: 'NOTION_SESSION_EXPIRED',
        openedAt: harness.clock.now().toISOString(),
        state: 'awaiting_user',
      },
      status: 'NEEDS_ATTENTION',
    });
    expect(waiting.incident?.openedAt).not.toBe(original.incident?.openedAt);
    expect(harness.qstash.published).toHaveLength(publishedAfterReplacement);
  });

  it('leaves a waiting job alone while its probe still fails', async () => {
    const { harness, maintenance } = setup({ probes: { google: 'GOOGLE_AUTH_REQUIRED' } });

    await waitingFor(harness, 'GOOGLE_AUTH_REQUIRED');

    const published = harness.qstash.published.length;

    await expect(maintenance.run()).resolves.toMatchObject({
      probes: { google: 'GOOGLE_AUTH_REQUIRED' },
      resumed: [],
    });
    expect(harness.qstash.published).toHaveLength(published);
  });

  it('keeps a transfer incident waiting while the Notion download credential is unusable', async () => {
    const { harness, maintenance } = setup({ probes: { notion: 'NOTION_SESSION_EXPIRED' } });

    harness.transfer.script = [
      { at: 'DOWNLOADING', error: new IntegrationError('NOTION_SESSION_EXPIRED') },
    ];
    await harness.service.start();
    await harness.drain();

    const before = await storedJob(harness, '2026-10');
    const published = harness.qstash.published.length;

    expect(before).toMatchObject({
      incident: { code: 'NOTION_SESSION_EXPIRED', stage: 'TRANSFER', state: 'awaiting_user' },
      status: 'NEEDS_ATTENTION',
    });
    await expect(maintenance.run()).resolves.toMatchObject({
      probes: { notion: 'NOTION_SESSION_EXPIRED' },
      resumed: [],
    });
    await expect(storedJob(harness, '2026-10')).resolves.toEqual(before);
    expect(harness.qstash.published).toHaveLength(published);
  });

  it('sends one lost warning when a probe finds access gone, not again while it stays gone', async () => {
    const { harness, maintenance, probes } = setup();

    await maintenance.run();
    expect(loginWarnings(harness)).toEqual([]);

    probes.google = 'GOOGLE_AUTH_REQUIRED';
    probes.drive = 'GOOGLE_AUTH_REQUIRED';
    harness.clock.advance(DAY_MS);
    await expect(maintenance.run()).resolves.toMatchObject({
      probes: { drive: 'GOOGLE_AUTH_REQUIRED', google: 'GOOGLE_AUTH_REQUIRED' },
    });
    expect(loginWarnings(harness)).toEqual([
      expect.objectContaining({ kind: 'lost', service: 'google' }),
    ]);
    await expect(harness.health.read()).resolves.toMatchObject({
      google: { code: 'GOOGLE_AUTH_REQUIRED', scopes: [], tokenOk: false },
    });

    // Still gone two days later: no repeat, the 24 h gate aside.
    harness.clock.advance(2 * DAY_MS);
    await maintenance.run();
    expect(loginWarnings(harness)).toHaveLength(1);
  });

  it('names a lost Drive folder apart from Google, and ignores a slow service', async () => {
    const { harness, maintenance, probes } = setup({ probes: { drive: 'DRIVE_UNAVAILABLE' } });

    await maintenance.run();
    expect(loginWarnings(harness)).toEqual([]);

    probes.drive = 'DRIVE_ROOT_INACCESSIBLE';
    harness.clock.advance(DAY_MS);
    await maintenance.run();
    expect(loginWarnings(harness)).toEqual([
      expect.objectContaining({ kind: 'lost', service: 'drive' }),
    ]);
  });

  it('warns 30, 7 and 1 days before the Notion sign-in expires, each once', async () => {
    const expiresAt = new Date(Date.parse(WEDNESDAY) + 30 * DAY_MS).toISOString();
    const { harness, maintenance } = setup({ notionExpiresAt: expiresAt });
    const sentOn: number[] = [];

    for (let day = 0; day < 31; day += 1) {
      const report = await maintenance.run();

      if (report.warnedDays !== undefined) {
        sentOn.push(report.warnedDays);
      }

      harness.clock.advance(DAY_MS);
    }

    expect(sentOn).toEqual([30, 7, 1]);
    expect(loginWarnings(harness)).toEqual([
      expect.objectContaining({ daysLeft: 30, expiresAt, kind: 'expiring', service: 'notion' }),
      expect.objectContaining({ daysLeft: 7, kind: 'expiring' }),
      expect.objectContaining({ daysLeft: 1, kind: 'expiring' }),
    ]);
  });

  it('pings /fail when a sub-step threw, and goes on with the rest', async () => {
    const { beats, harness, maintenance, probes } = setup();

    probes.google = new Error('unexpected');
    harness.health.write = () => Promise.reject(new Error('Redis unreachable'));

    const report = await maintenance.run();

    expect(report.ok).toBe(false);
    expect(report.failedSteps).toEqual(['touch', 'probe.google', 'probe.drive', 'record']);
    expect(beats).toEqual(['fail']);
  });

  it('is not failed by its own heartbeat', async () => {
    const { beats, maintenance } = setup({ heartbeatThrows: true });

    await expect(maintenance.run()).resolves.toMatchObject({ ok: true });
    expect(beats).toEqual(['ok']);
  });
});

describe('DailyMaintenance.probe', () => {
  it('records and reports one probe, failures by code only', async () => {
    const { harness, maintenance } = setup({ probes: { notion: 'NOTION_SESSION_EXPIRED' } });

    await expect(maintenance.probe('google')).resolves.toEqual({
      ok: true,
      probe: 'google',
      scopes: ['gmail.readonly', 'drive.file'],
    });
    await expect(maintenance.probe('notion')).resolves.toEqual({
      code: 'NOTION_SESSION_EXPIRED',
      notionSession: 'expired',
      ok: false,
      probe: 'notion',
    });
    await expect(harness.health.read()).resolves.toMatchObject({
      notionSession: { code: 'NOTION_SESSION_EXPIRED', state: 'expired' },
    });
    expect(harness.qstash.published).toEqual([]);
  });

  it('reports an unexpected failure as UNKNOWN_ERROR', async () => {
    const { maintenance } = setup({ probes: { drive: new Error('boom') } });

    await expect(maintenance.probe('drive')).resolves.toEqual({
      code: 'UNKNOWN_ERROR',
      ok: false,
      probe: 'drive',
    });
  });
});

describe('isStuck', () => {
  it('is never true for a job that waits for you or a wakeup that is not late', () => {
    const waiting = waitingJob();
    const now = new Date(Date.parse(waiting.updatedAt) + STUCK_AFTER_MS + 1);

    expect(isStuck(attentionJob('NOTION_SESSION_EXPIRED'), hoursAfter(100))).toBe(false);
    // An incident the supervisor still decides on gets wakeups, so a lost one is re-armed.
    expect(isStuck(attentionJob('NOTION_UI_CHANGED'), hoursAfter(100))).toBe(true);
    expect(
      isStuck({ ...waiting, schedule: { notBefore: now.toISOString(), token: TEST_TOKEN } }, now),
    ).toBe(false);
    expect(
      isStuck({ ...waiting, schedule: { notBefore: waiting.updatedAt, token: TEST_TOKEN } }, now),
    ).toBe(true);
    expect(isStuck(waiting, now)).toBe(true);
  });
});
