import { describe, expect, it } from 'vitest';

import { InMemoryNotificationGate } from '../../src/adapters/persistence/redis-notification-gate.js';
import { InMemoryNotionLoginSlot } from '../../src/adapters/persistence/redis-notion-login-slot.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import { LoginWarnings } from '../../src/application/login-watch.js';
import {
  NOTION_LOGIN_INTERVAL_SEC,
  NotionAutoLogin,
  NotionLoginRequests,
} from '../../src/application/notion-auto-login.js';
import { NotionLoginError } from '../../src/application/notion-login-error.js';
import type {
  NotionEmailLogin,
  NotionLoginQueue,
  NotionLoginRequest,
} from '../../src/application/ports.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';

const NEW_EXPIRY = '2027-11-05T15:03:59.000Z';
const ATTEMPT = 'attempt-0123456789abcdef';

function queue(failure?: Error): NotionLoginQueue & { readonly requests: NotionLoginRequest[] } {
  const requests: NotionLoginRequest[] = [];

  return {
    enqueueNotionLogin: (request) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }

      requests.push(request);

      return Promise.resolve();
    },
    requests,
  };
}

function requestsSetup(options: { enabled?: boolean; failure?: Error; queued?: boolean } = {}) {
  const harness = backupHarness();
  const loginQueue = queue(options.failure);
  const slot = new InMemoryNotionLoginSlot(harness.clock);
  const requests = new NotionLoginRequests({
    enabled: options.enabled ?? true,
    ids: harness.ids,
    logger: harness.logger,
    queue: options.queued === false ? undefined : loginQueue,
    slot,
  });

  return { harness, loginQueue, requests, slot };
}

/** A job waiting for the Notion login, the `_notion-login` runner, and its fakes. */
async function runSetup(
  options: {
    budgetMs?: number;
    /** Whether the delivered attempt holds the day's slot; true by default. */
    claimed?: boolean;
    enabled?: boolean;
    expiresAt?: string;
    renew?: (signal: AbortSignal) => Promise<{ authCookieExpiresAt?: string }>;
    waiting?: boolean;
  } = {},
) {
  const harness = backupHarness();

  if (options.waiting !== false) {
    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.service.start();
    await harness.drain();
  }

  const signals: AbortSignal[] = [];
  const login: NotionEmailLogin = {
    renewSession: (signal) => {
      signals.push(signal);

      return options.renew?.(signal) ?? Promise.resolve({ authCookieExpiresAt: NEW_EXPIRY });
    },
  };
  const warnings = new LoginWarnings({
    clock: harness.clock,
    gate: harness.gate,
    logger: harness.logger,
    notifications: harness.notifications,
    warningDays: [30, 7, 1],
  });
  const slot = new InMemoryNotionLoginSlot(harness.clock);

  if (options.claimed !== false) {
    await slot.claim(ATTEMPT, NOTION_LOGIN_INTERVAL_SEC);
  }

  const autoLogin = new NotionAutoLogin({
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    clock: harness.clock,
    enabled: options.enabled ?? true,
    gate: new InMemoryNotificationGate(harness.clock),
    health: harness.health,
    jobs: harness.jobs,
    logger: harness.logger,
    login,
    notifications: harness.notifications,
    service: harness.service,
    sessionInfo: { authCookieExpiresAt: () => Promise.resolve(options.expiresAt) },
    slot,
    warnings,
  });

  return { autoLogin, harness, signals };
}

const request = (trigger: NotionLoginRequest['trigger'] = 'expired'): NotionLoginRequest => ({
  attempt: ATTEMPT,
  trigger,
});

describe('NotionLoginRequests', () => {
  it('queues one login with a fresh attempt ID, then refuses others for 24 h', async () => {
    const { harness, loginQueue, requests } = requestsSetup();

    await expect(requests.request('expired')).resolves.toBe('queued');
    await expect(requests.request('expiring')).resolves.toBe('refused');
    expect(loginQueue.requests).toHaveLength(1);
    expect(loginQueue.requests[0]).toMatchObject({ trigger: 'expired' });
    expect(loginQueue.requests[0]?.attempt).toMatch(/^[\w-]{16,64}$/);

    harness.clock.advance(NOTION_LOGIN_INTERVAL_SEC * 1000);

    await expect(requests.request('expiring')).resolves.toBe('queued');
    expect(loginQueue.requests.at(-1)).toMatchObject({ trigger: 'expiring' });
    expect(loginQueue.requests[0]?.attempt).not.toBe(loginQueue.requests[1]?.attempt);
  });

  it('asks nothing while the flag is off or nothing may publish', async () => {
    const off = requestsSetup({ enabled: false });
    const local = requestsSetup({ queued: false });

    await expect(off.requests.request('expired')).resolves.toBe('disabled');
    await expect(local.requests.request('expired')).resolves.toBe('disabled');
    expect(off.loginQueue.requests).toHaveLength(0);
    // Nothing claimed: turning the flag on later finds the day's attempt unused.
    await expect(off.slot.claim(ATTEMPT, 60)).resolves.toBe(true);
  });

  it('reports a failed publish, and spends the day’s attempt rather than risk a second', async () => {
    const { requests } = requestsSetup({ failure: new Error('QStash down') });

    await expect(requests.request('expired')).resolves.toBe('failed');
    await expect(requests.request('expired')).resolves.toBe('refused');
  });
});

describe('NotionAutoLogin', () => {
  it('renews the session, records it, resumes the waiting job and says so', async () => {
    const { autoLogin, harness, signals } = await runSetup();

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      incident: { code: 'NOTION_SESSION_EXPIRED' },
      status: 'NEEDS_ATTENTION',
    });

    await expect(autoLogin.run(request())).resolves.toEqual({
      outcome: 'renewed',
      resumedJobId: '2026-10',
    });
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'TRIGGERING_EXPORT',
    });
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'retry' });
    expect(harness.sent.at(-1)).toMatchObject({
      kind: 'loginWarning',
      notification: { expiresAt: NEW_EXPIRY, kind: 'renewed', service: 'notion' },
    });
    await expect(harness.health.read()).resolves.toMatchObject({
      notionLogin: { outcome: 'renewed', trigger: 'expired' },
      notionSession: { authCookieExpiresAt: NEW_EXPIRY, state: 'valid' },
    });
    expect(signals[0]?.aborted).toBe(false);
  });

  it('runs each attempt once, however often QStash delivers it', async () => {
    const { autoLogin, signals } = await runSetup({ waiting: false });

    await expect(autoLogin.run(request())).resolves.toMatchObject({ outcome: 'renewed' });
    await expect(autoLogin.run(request())).resolves.toEqual({ outcome: 'duplicate' });
    expect(signals).toHaveLength(1);
  });

  it('runs no attempt that does not hold the day’s slot', async () => {
    const { autoLogin, harness, signals } = await runSetup({ claimed: false, waiting: false });
    const sent = harness.sent.length;

    await expect(autoLogin.run(request())).resolves.toEqual({ outcome: 'stale' });
    expect(signals).toHaveLength(0);
    expect(harness.sent).toHaveLength(sent);
  });

  it('runs nothing once the flag is off', async () => {
    const { autoLogin, signals } = await runSetup({ enabled: false, waiting: false });

    await expect(autoLogin.run(request())).resolves.toEqual({ outcome: 'disabled' });
    expect(signals).toHaveLength(0);
  });

  it('after a failed login sends one lost warning and leaves the job waiting', async () => {
    const { autoLogin, harness } = await runSetup({
      renew: () => Promise.reject(new NotionLoginError('email_missing', 'No email')),
    });
    const sent = harness.sent.length;

    await expect(autoLogin.run(request())).resolves.toEqual({
      failure: 'email_missing',
      outcome: 'failed',
    });
    expect(harness.sent.slice(sent)).toEqual([
      expect.objectContaining({
        kind: 'loginWarning',
        notification: expect.objectContaining({ kind: 'lost', service: 'notion' }),
      }),
    ]);
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'NEEDS_ATTENTION',
    });
    await expect(harness.health.read()).resolves.toMatchObject({
      notionLogin: { failure: 'email_missing', outcome: 'failed', trigger: 'expired' },
    });
  });

  it('classifies a challenge from the session gate, and never retries it', async () => {
    let calls = 0;
    const { autoLogin } = await runSetup({
      renew: () => {
        calls += 1;

        return Promise.reject(new IntegrationError('NOTION_INTERACTIVE_CHALLENGE'));
      },
      waiting: false,
    });

    await expect(autoLogin.run(request())).resolves.toMatchObject({ failure: 'challenge' });
    expect(calls).toBe(1);
  });

  it('after a failed renewal ahead of time sends the expiry warning it replaced', async () => {
    const { autoLogin, harness } = await runSetup({
      expiresAt: '2026-10-20T00:00:00.000Z',
      renew: () => Promise.reject(new NotionLoginError('ui_changed', 'No code field')),
      waiting: false,
    });

    await expect(autoLogin.run(request('expiring'))).resolves.toMatchObject({
      failure: 'ui_changed',
    });
    expect(harness.sent.at(-1)).toMatchObject({
      kind: 'loginWarning',
      notification: { daysLeft: 19, kind: 'expiring', service: 'notion' },
    });
  });

  it.each([
    ['no readable expiry', undefined],
    ['an expiry that passed meanwhile', '2026-09-30T00:00:00.000Z'],
  ])(
    'after a failed renewal ahead of time with %s, sends lost instead of nothing',
    async (_case, expiresAt) => {
      const { autoLogin, harness } = await runSetup({
        ...(expiresAt === undefined ? {} : { expiresAt }),
        renew: () => Promise.reject(new NotionLoginError('ui_changed', 'No code field')),
        waiting: false,
      });

      await expect(autoLogin.run(request('expiring'))).resolves.toMatchObject({
        outcome: 'failed',
      });
      expect(harness.sent.at(-1)).toMatchObject({
        kind: 'loginWarning',
        notification: { kind: 'lost', service: 'notion' },
      });
    },
  );

  it('reports a login that outlives its budget as a timeout', async () => {
    const { autoLogin } = await runSetup({
      budgetMs: 10,
      renew: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        }),
      waiting: false,
    });

    await expect(autoLogin.run(request())).resolves.toMatchObject({ failure: 'timeout' });
  });
});
