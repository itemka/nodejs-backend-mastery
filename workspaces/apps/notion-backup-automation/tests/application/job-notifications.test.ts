import { describe, expect, it } from 'vitest';

import { CompositeNotifier } from '../../src/adapters/notifications/composite-notifier.js';
import { InMemoryJobRepository } from '../../src/adapters/persistence/in-memory-job-repository.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisHealthStore } from '../../src/adapters/persistence/redis-health-store.js';
import { InMemoryNotificationGate } from '../../src/adapters/persistence/redis-notification-gate.js';
import { JobNotifications, REPEAT_WINDOW_SEC } from '../../src/application/job-notifications.js';
import type {
  JobRepository,
  LoginWarningNotification,
  NotificationGate,
  Notifier,
} from '../../src/application/ports.js';
import { failLifetimeExceeded } from '../../src/domain/job-lifecycle.js';
import type { BackupJob } from '../../src/domain/job.js';
import { createLogger } from '../../src/shared/logger.js';
import { FakeRedis } from '../support/fake-redis.js';
import {
  attentionJob,
  hoursAfter,
  completeJob,
  jobInStatus,
  minutesAfter,
  policy,
  valid,
} from '../support/jobs.js';
import { ManualClock } from '../support/manual-clock.js';

interface Delivery {
  kind: keyof Notifier;
  notification: unknown;
}

function recordingNotifier(deliveries: Delivery[], failing = false): Notifier {
  const deliver = (kind: keyof Notifier) => (notification: unknown) => {
    deliveries.push({ kind, notification });

    return failing ? Promise.reject(new Error('channel down')) : Promise.resolve();
  };

  return {
    attention: deliver('attention'),
    failure: deliver('failure'),
    loginWarning: deliver('loginWarning'),
    success: deliver('success'),
  };
}

function setup(
  overrides: {
    devFolder?: boolean;
    gate?: NotificationGate;
    jobs?: JobRepository;
    notifier?: Notifier;
  } = {},
) {
  const clock = new ManualClock(minutesAfter(10));
  const deliveries: Delivery[] = [];
  const logs: Record<string, unknown>[] = [];
  const jobs = overrides.jobs ?? new InMemoryJobRepository(clock);
  const redis = new FakeRedis();
  const health = new RedisHealthStore(redis, keyPrefixFor('test'));
  const logger = createLogger({
    level: 'debug',
    sink: (_level, line) => {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const notifications = new JobNotifications({
    clock,
    devFolder: overrides.devFolder ?? false,
    gate: overrides.gate ?? new InMemoryNotificationGate(clock),
    health,
    jobs,
    logger,
    notifier: overrides.notifier ?? recordingNotifier(deliveries),
    policy,
  });

  return { clock, deliveries, health, jobs, logs, notifications };
}

const lostNotion: LoginWarningNotification = {
  howToFix: 'Run auth:notion.',
  kind: 'lost',
  service: 'notion',
};

describe('JobNotifications', () => {
  it('reports a COMPLETE job and records the notification as a job event', async () => {
    const { deliveries, jobs, notifications } = setup();

    await notifications.success(completeJob());

    expect(deliveries).toEqual([
      {
        kind: 'success',
        notification: {
          driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
          durationMs: 9 * 60_000,
          entryCount: 198,
          fileName: 'notion-workspace-2026-10-01.zip',
          folder: '2026',
          jobId: '2026-10',
          period: '2026-10',
          sizeBytes: 8_907_221,
        },
      },
    ]);
    await expect(jobs.listEvents('2026-10', { limit: 10 })).resolves.toEqual([
      {
        at: minutesAfter(10).toISOString(),
        status: 'COMPLETE',
        text: '✅ Notion backup completed · job 2026-10 · 198 files (8.9 MB) · notion-workspace-2026-10-01.zip in 2026 · 9 m 0 s',
        type: 'notification',
      },
    ]);
  });

  it('names the _dev folder for APP_ENV=dev, and passes a shrink on', async () => {
    const { deliveries, jobs, notifications } = setup({ devFolder: true });
    const job = completeJob();
    const shrunk: BackupJob = valid({
      ...job,
      result: {
        ...job.result!,
        entryCount: 3,
        shrink: { previousEntryCount: 198, previousJobId: '2026-09', previousSizeBytes: 8_907_221 },
        sizeBytes: 1104,
      },
    });

    await notifications.success(shrunk);

    expect(deliveries[0]?.notification).toMatchObject({
      folder: '_dev/2026',
      shrink: { previousEntryCount: 198, previousJobId: '2026-09', previousSizeBytes: 8_907_221 },
    });
    const [event] = await jobs.listEvents('2026-10', { limit: 1 });

    expect(event?.text).toBe(
      '⚠️ Notion backup stored, but much smaller than the last one · job 2026-10 · 3 files (1.1 KB); last backup (2026-09) had 198 files (8.9 MB) · notion-workspace-2026-10-01.zip in _dev/2026',
    );
  });

  it('sends attention with the fix and the recent events, once per job and code per 24 h', async () => {
    const { clock, deliveries, jobs, notifications } = setup();
    const job = attentionJob('NOTION_SESSION_EXPIRED');

    await jobs.appendEvent(job.id, {
      at: minutesAfter(3).toISOString(),
      status: 'NEEDS_ATTENTION',
      text: 'TRIGGERING_EXPORT → NEEDS_ATTENTION (NOTION_SESSION_EXPIRED)',
      type: 'transition',
    });

    await notifications.attention(job, 'Sign in again.');
    await notifications.attention(job);

    expect(deliveries).toEqual([
      {
        kind: 'attention',
        notification: {
          code: 'NOTION_SESSION_EXPIRED',
          howToFix: 'Run auth:notion, then run backup_retry.',
          jobId: '2026-10',
          period: '2026-10',
          reason: 'The saved Notion session is no longer signed in.',
          recentEvents: [
            {
              at: minutesAfter(3).toISOString(),
              text: 'TRIGGERING_EXPORT → NEEDS_ATTENTION (NOTION_SESSION_EXPIRED)',
            },
          ],
          retryFromScratch: true,
          stage: 'NOTION_TRIGGER',
          supervisorSummary: 'Sign in again.',
        },
      },
    ]);

    const events = await jobs.listEvents(job.id, { limit: 10 });

    expect(events.at(-1)).toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
      status: 'NEEDS_ATTENTION',
      type: 'notification',
    });
    expect(events).toHaveLength(2);

    await notifications.attention(attentionJob('NOTION_INTERACTIVE_CHALLENGE'));
    expect(deliveries).toHaveLength(2);

    clock.advance(REPEAT_WINDOW_SEC * 1000);
    await notifications.attention(job);
    expect(deliveries).toHaveLength(3);
  });

  it('offers no new export attempt at the attempt cap', async () => {
    const { deliveries, notifications } = setup();

    await notifications.attention(
      valid({ ...attentionJob(), exportAttempt: policy.maxExportAttempts }),
    );

    expect(deliveries[0]?.notification).toMatchObject({ retryFromScratch: false });
  });

  it('reports a FAILED job with its stage and code', async () => {
    const { deliveries, notifications } = setup();

    await notifications.failure(jobInStatus('FAILED'));

    expect(deliveries).toEqual([
      {
        kind: 'failure',
        notification: {
          code: 'JOB_LIFETIME_EXCEEDED',
          jobId: '2026-10',
          period: '2026-10',
          reason: 'The job exceeded its maximum lifetime.',
          stage: 'EMAIL_WAIT',
        },
      },
    ]);
  });

  it('records a failure under its own code, not an incident left from before', async () => {
    const { jobs, notifications } = setup();
    const failed = valid(
      failLifetimeExceeded(attentionJob('NOTION_SESSION_EXPIRED'), hoursAfter(168)),
    );

    expect(failed.incident?.code).toBe('NOTION_SESSION_EXPIRED');
    await notifications.failure(failed);

    await expect(jobs.listEvents('2026-10', { limit: 1 })).resolves.toEqual([
      expect.objectContaining({
        code: 'JOB_LIFETIME_EXCEEDED',
        status: 'FAILED',
        type: 'notification',
      }),
    ]);
  });

  it('sends a lost warning once per service per 24 h, and records the last warning in health', async () => {
    const { clock, deliveries, health, notifications } = setup();

    await notifications.loginWarning(lostNotion);
    await notifications.loginWarning(lostNotion);
    await notifications.loginWarning({ ...lostNotion, service: 'google' });

    expect(
      deliveries.map(({ notification }) => (notification as LoginWarningNotification).service),
    ).toEqual(['notion', 'google']);

    clock.advance(REPEAT_WINDOW_SEC * 1000);
    await notifications.loginWarning(lostNotion);
    expect(deliveries).toHaveLength(3);
    await expect(health.read()).resolves.toMatchObject({
      loginWarning: { kind: 'lost', sentAt: clock.now().toISOString(), service: 'notion' },
    });
  });

  it('does not gate expiring warnings: each threshold is marked by its caller', async () => {
    const { deliveries, notifications } = setup();
    const expiring: LoginWarningNotification = {
      daysLeft: 7,
      expiresAt: '2027-10-22T23:47:00.000Z',
      howToFix: 'Run auth:notion.',
      kind: 'expiring',
      service: 'notion',
    };

    await notifications.loginWarning(expiring);
    await notifications.loginWarning({ ...expiring, daysLeft: 1 });

    expect(deliveries).toHaveLength(2);
  });

  it('never fails the caller: a failing Telegram behind the composite still leaves the event', async () => {
    const deliveries: Delivery[] = [];
    const logs: string[] = [];
    const logger = createLogger({ sink: (_level, line) => logs.push(line) });
    const notifier = new CompositeNotifier(
      [{ name: 'telegram', notifier: recordingNotifier(deliveries, true) }],
      logger,
    );
    const { jobs, notifications } = setup({ notifier });

    await expect(notifications.success(completeJob())).resolves.toBeUndefined();

    expect(deliveries).toHaveLength(1);
    await expect(jobs.listEvents('2026-10', { limit: 1 })).resolves.toHaveLength(1);
    expect(logs.join('\n')).toContain('notify.failed');
  });

  it('never fails the caller when the notifier or the event store throws', async () => {
    const jobs = new InMemoryJobRepository();

    jobs.appendEvent = () => Promise.reject(new Error('redis down'));

    const failingStore = setup({ jobs });
    const failingNotifier = setup({ notifier: recordingNotifier([], true) });

    await expect(failingStore.notifications.success(completeJob())).resolves.toBeUndefined();
    await expect(
      failingNotifier.notifications.failure(jobInStatus('FAILED')),
    ).resolves.toBeUndefined();

    expect(failingStore.deliveries).toHaveLength(1);
    expect(failingStore.logs).toContainEqual(
      expect.objectContaining({ event: 'notify.record.failed', jobId: '2026-10', kind: 'success' }),
    );
    expect(failingNotifier.logs).toContainEqual(
      expect.objectContaining({ event: 'notify.record.failed', kind: 'failure' }),
    );
  });

  it('lets a notification through when the gate cannot answer', async () => {
    const gate: NotificationGate = { claim: () => Promise.reject(new Error('redis down')) };
    const { deliveries, logs, notifications } = setup({ gate });

    await notifications.attention(attentionJob());

    expect(deliveries).toHaveLength(1);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'notify.gate.failed' }));
  });

  it('refuses to report a job in the wrong state, without throwing', async () => {
    const { deliveries, logs, notifications } = setup();

    await notifications.success(attentionJob());
    await notifications.attention(completeJob());

    expect(deliveries).toEqual([]);
    expect(logs.filter(({ event }) => event === 'notify.record.failed')).toHaveLength(2);
  });
});
