import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { GoogleRelogin } from '../../src/application/google-relogin.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import type { HealthProbes } from '../../src/application/ports.js';
import { PROBE_BUDGET_MS, ProbeRunner } from '../../src/application/probe-runner.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';

const appRoot = path.resolve(import.meta.dirname, '../..');

const passing: Pick<HealthProbes, 'drive' | 'google'> = {
  drive: () => Promise.resolve({ mode: 'existing' }),
  google: () => Promise.resolve({ scopes: ['gmail.readonly', 'drive.file'] }),
};

/** A job waiting for the Google login, and the re-login's follow-up on the same harness. */
async function setup(probes: Pick<HealthProbes, 'drive' | 'google'> = passing) {
  const harness = backupHarness();

  harness.trigger.script = [new IntegrationError('GOOGLE_AUTH_REQUIRED')];
  await harness.service.start();
  await harness.drain();

  const relogin = new GoogleRelogin({
    jobs: harness.jobs,
    logger: harness.logger,
    notifications: harness.notifications,
    probes: new ProbeRunner({
      clock: harness.clock,
      health: harness.health,
      logger: harness.logger,
      probes,
      timeZone: 'Europe/Warsaw',
    }),
    service: harness.service,
  });

  return { harness, relogin };
}

describe('GoogleRelogin', () => {
  it('checks the new token, resumes the job waiting for Google, and says so', async () => {
    const { harness, relogin } = await setup();

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      incident: { code: 'GOOGLE_AUTH_REQUIRED' },
      status: 'NEEDS_ATTENTION',
    });

    const report = await relogin.afterRenewal();

    expect(report).toMatchObject({
      drive: { ok: true },
      google: { ok: true },
      resumedJobId: '2026-10',
    });
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'TRIGGERING_EXPORT',
    });
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'retry' });
    expect(harness.sent.at(-1)).toMatchObject({
      kind: 'loginWarning',
      notification: { kind: 'renewed', service: 'google' },
    });
    await expect(harness.health.read()).resolves.toMatchObject({
      driveRoot: { mode: 'existing', ok: true },
      google: { scopes: ['gmail.readonly', 'drive.file'], tokenOk: true },
    });
  });

  it('resumes nothing and claims no renewal while the Google probe fails', async () => {
    const { harness, relogin } = await setup({
      ...passing,
      google: () => Promise.reject(new IntegrationError('GOOGLE_AUTH_REQUIRED')),
    });
    const before = await storedJob(harness, '2026-10');
    const sent = harness.sent.length;

    const report = await relogin.afterRenewal();

    expect(report.resumedJobId).toBeUndefined();
    expect(report.google).toMatchObject({ code: 'GOOGLE_AUTH_REQUIRED', ok: false });
    await expect(storedJob(harness, '2026-10')).resolves.toEqual(before);
    expect(harness.sent).toHaveLength(sent);
    await expect(harness.health.read()).resolves.toMatchObject({
      google: { code: 'GOOGLE_AUTH_REQUIRED', tokenOk: false },
    });
  });
});

describe('GoogleRelogin and a busy job (review, 2026-11-02)', () => {
  it('keeps the renewal when another invocation holds the job, and leaves it waiting', async () => {
    const { harness, relogin } = await setup();

    await harness.jobs.acquireLease('2026-10', 'another-invocation', 60_000);

    const report = await relogin.afterRenewal();

    expect(report).toMatchObject({ google: { ok: true }, pendingJobId: '2026-10' });
    expect(report.resumedJobId).toBeUndefined();
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      incident: { code: 'GOOGLE_AUTH_REQUIRED', state: 'awaiting_user' },
      status: 'NEEDS_ATTENTION',
    });
    expect(harness.sent.at(-1)).toMatchObject({
      kind: 'loginWarning',
      notification: { kind: 'renewed', service: 'google' },
    });
    expect(harness.logs).toContainEqual(
      expect.objectContaining({ event: 'google.relogin.resume_deferred', jobId: '2026-10' }),
    );
  });

  it('still fails on anything else, such as Redis going away', async () => {
    const { harness, relogin } = await setup();

    vi.spyOn(harness.service, 'retryIncident').mockRejectedValue(new Error('redis down'));

    await expect(relogin.afterRenewal()).rejects.toThrow('redis down');
  });
});

describe('GoogleRelogin within its function limit (Codex review, 2026-11-02)', () => {
  it('runs the Google and Drive probes at once', async () => {
    const started: string[] = [];
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const { relogin } = await setup({
      drive: async () => {
        started.push('drive');
        await gate;

        return { mode: 'existing' };
      },
      google: async () => {
        started.push('google');
        await gate;

        return { scopes: ['gmail.readonly', 'drive.file'] };
      },
    });
    const report = relogin.afterRenewal();

    await vi.waitFor(() => {
      expect(started.toSorted()).toEqual(['drive', 'google']);
    });
    release();
    await expect(report).resolves.toMatchObject({ google: { ok: true }, resumedJobId: '2026-10' });
  });

  it('fits the slower probe budget, with time to spare, in the /oauth function limit', () => {
    const config = JSON.parse(readFileSync(path.join(appRoot, 'vercel.json'), 'utf8')) as {
      functions: Record<string, { maxDuration: number }>;
    };
    const limitMs = (config.functions['api/oauth/[action].ts']?.maxDuration ?? 0) * 1000;
    // The code exchange, the ID-token keys, the save, the resume and the Telegram notice.
    const overheadMs = 30_000;

    expect(limitMs).toBeGreaterThanOrEqual(
      Math.max(PROBE_BUDGET_MS.google, PROBE_BUDGET_MS.drive) + overheadMs,
    );
  });
});
