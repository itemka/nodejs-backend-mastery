import { describe, expect, it } from 'vitest';

import { InMemoryNotificationGate } from '../../src/adapters/persistence/redis-notification-gate.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import {
  awaitedLogin,
  LoginWarnings,
  loginServiceOf,
  resumeAfterLoginFix,
} from '../../src/application/login-watch.js';
import type { LoginService, LoginWarningNotification } from '../../src/application/ports.js';
import type { ErrorCode } from '../../src/domain/error-catalog.js';
import { errorCodes } from '../../src/domain/error-catalog.js';
import { createLogger } from '../../src/shared/logger.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { attentionJob, jobInStatus } from '../support/jobs.js';
import { ManualClock } from '../support/manual-clock.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const logger = createLogger({
  sink: () => {
    // Not under test.
  },
});

describe('loginServiceOf and awaitedLogin', () => {
  it('maps exactly the login codes to their service', () => {
    const mapped = Object.fromEntries(
      errorCodes.flatMap((code) => {
        const service = loginServiceOf(code);

        return service === undefined ? [] : [[code, service]];
      }),
    );

    expect(mapped).toEqual({
      DRIVE_ROOT_INACCESSIBLE: 'drive',
      GOOGLE_AUTH_REQUIRED: 'google',
      NOTION_INTERACTIVE_CHALLENGE: 'notion',
      NOTION_SESSION_EXPIRED: 'notion',
      NOTION_WRONG_WORKSPACE: 'notion',
    });
  });

  it('names the login only while the job waits for you', () => {
    expect(awaitedLogin(attentionJob('NOTION_SESSION_EXPIRED'))).toBe('notion');
    expect(awaitedLogin(attentionJob('GOOGLE_AUTH_REQUIRED'))).toBe('google');
    // Supervised codes wait for the supervisor first; NOTION_UI_CHANGED is no login.
    expect(awaitedLogin(attentionJob('NOTION_UI_CHANGED'))).toBeUndefined();

    for (const status of [
      'CREATED',
      'WAITING_FOR_EMAIL',
      'RETRYABLE_FAILURE',
      'COMPLETE',
    ] as const) {
      expect(awaitedLogin(jobInStatus(status))).toBeUndefined();
    }
  });
});

describe('resumeAfterLoginFix', () => {
  async function waiting(code: ErrorCode) {
    const harness = backupHarness();

    harness.trigger.script = [new IntegrationError(code)];
    await harness.service.start();
    await harness.drain();

    return harness;
  }

  it('retries the active job waiting for that login, with a wakeup', async () => {
    const harness = await waiting('NOTION_WRONG_WORKSPACE');
    const resumed = await resumeAfterLoginFix(
      { job: await storedJob(harness, '2026-10'), logger, service: harness.service },
      'notion',
    );

    expect(resumed).toMatchObject({ id: '2026-10', status: 'TRIGGERING_EXPORT' });
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'retry' });
  });

  it.each<[ErrorCode, LoginService]>([
    ['NOTION_SESSION_EXPIRED', 'google'],
    ['NOTION_SESSION_EXPIRED', 'drive'],
    ['NOTION_UI_CHANGED', 'notion'],
  ])('leaves a job waiting on %s alone when %s is fixed', async (code, service) => {
    const harness = await waiting(code);
    const before = await storedJob(harness, '2026-10');
    const published = harness.qstash.published.length;

    await expect(
      resumeAfterLoginFix({ job: before, logger, service: harness.service }, service),
    ).resolves.toBeUndefined();
    await expect(storedJob(harness, '2026-10')).resolves.toEqual(before);
    expect(harness.qstash.published).toHaveLength(published);
  });

  it.each<ErrorCode>(['CONFIG_INCOMPLETE', 'NOTION_SESSION_EXPIRED'])(
    'leaves alone a newer %s incident that replaced the one it read',
    async (newer) => {
      const harness = await waiting('NOTION_SESSION_EXPIRED');
      const read = await harness.jobs.findActive();

      // You retry it yourself meanwhile, and the worker hits a new incident.
      harness.clock.advance(60_000);
      harness.trigger.script = [new IntegrationError(newer)];
      await harness.service.retry('2026-10');
      await harness.drain();

      const before = await storedJob(harness, '2026-10');
      const published = harness.qstash.published.length;

      expect(before).toMatchObject({
        incident: { code: newer, state: 'awaiting_user' },
        status: 'NEEDS_ATTENTION',
      });
      await expect(
        resumeAfterLoginFix({ job: read?.job, logger, service: harness.service }, 'notion'),
      ).resolves.toBeUndefined();
      await expect(storedJob(harness, '2026-10')).resolves.toEqual(before);
      expect(harness.qstash.published).toHaveLength(published);
    },
  );

  it('does nothing without an active job, or for a job that is running', async () => {
    const harness = backupHarness();
    const deps = { logger, service: harness.service };

    await expect(
      resumeAfterLoginFix({ ...deps, job: undefined }, 'notion'),
    ).resolves.toBeUndefined();

    await harness.service.start();
    await expect(
      resumeAfterLoginFix({ ...deps, job: await storedJob(harness, '2026-10') }, 'notion'),
    ).resolves.toBeUndefined();
    expect(harness.qstash.published).toHaveLength(1);
  });
});

function warningsSetup(warningDays = [30, 7, 1]) {
  const clock = new ManualClock('2026-10-01T04:00:00.000Z');
  const sent: LoginWarningNotification[] = [];
  const warnings = new LoginWarnings({
    clock,
    gate: new InMemoryNotificationGate(clock),
    logger,
    notifications: {
      loginWarning: (notification) => {
        sent.push(notification);

        return Promise.resolve();
      },
    },
    warningDays,
  });

  return { clock, sent, warnings };
}

const inDays = (clock: ManualClock, days: number) =>
  new Date(clock.now().getTime() + days * DAY_MS).toISOString();

describe('LoginWarnings', () => {
  it('sends nothing without a recorded expiry, or past it', async () => {
    const { clock, sent, warnings } = warningsSetup();

    await expect(warnings.notionExpiring()).resolves.toBeUndefined();
    await expect(warnings.notionExpiring(inDays(clock, -1))).resolves.toBeUndefined();
    await expect(warnings.notionExpiring('not a date')).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('sends one warning, the nearest threshold, after missed days', async () => {
    const { clock, sent, warnings } = warningsSetup();
    const expiresAt = inDays(clock, 5);

    await expect(warnings.notionExpiring(expiresAt)).resolves.toBe(7);
    await expect(warnings.notionExpiring(expiresAt)).resolves.toBeUndefined();
    expect(sent).toEqual([
      {
        daysLeft: 5,
        expiresAt,
        howToFix: 'Run auth:notion on your Mac; a waiting job resumes by itself.',
        kind: 'expiring',
        service: 'notion',
      },
    ]);
  });

  it('starts over when a rolling refresh moves the expiry', async () => {
    const { clock, sent, warnings } = warningsSetup();
    const first = inDays(clock, 30);

    await expect(warnings.notionExpiring(first)).resolves.toBe(30);

    clock.advance(DAY_MS);

    const moved = inDays(clock, 30);

    await expect(warnings.notionExpiring(first)).resolves.toBeUndefined();
    await expect(warnings.notionExpiring(moved)).resolves.toBe(30);
    expect(sent.map((warning) => warning.expiresAt)).toEqual([first, moved]);
  });

  it('sends lost with the service’s fix', async () => {
    const { sent, warnings } = warningsSetup();

    await warnings.lost('drive');

    expect(sent).toEqual([
      {
        howToFix:
          'Run drive:check and restore the folder access; a waiting job resumes with the next daily cron.',
        kind: 'lost',
        service: 'drive',
      },
    ]);
  });
});
