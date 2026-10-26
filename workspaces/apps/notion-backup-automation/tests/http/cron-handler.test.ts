import { describe, expect, it } from 'vitest';

import type { DailyReport, ProbeReport } from '../../src/application/daily-maintenance.js';
import { ConfigError } from '../../src/config/env.js';
import { isBearer } from '../../src/http/cron-auth.js';
import type { CronHandlerDeps } from '../../src/http/cron-handler.js';
import { handleCronRequest } from '../../src/http/cron-handler.js';
import { createLogger } from '../../src/shared/logger.js';

const SECRET = 'cron-secret-0123456789abcdefghijklmnopqrstuv';
const URL_BASE = 'https://nba.example.vercel.app/api/cron/daily';

const okReport: DailyReport = {
  autoStart: 'disabled',
  failedSteps: [],
  ok: true,
  probes: { drive: 'ok', google: 'ok' },
  resumed: [],
  watchdog: 'idle',
};

function setup(overrides: Partial<CronHandlerDeps> = {}, report: DailyReport = okReport) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: CronHandlerDeps = {
    cronSecret: SECRET,
    logger: createLogger({
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    maintenance: () => ({
      probe: (name): Promise<ProbeReport> => {
        calls.push(`probe:${name}`);

        return Promise.resolve({ mode: 'existing', ok: true, probe: 'drive' });
      },
      run: () => {
        calls.push('run');

        return Promise.resolve(report);
      },
    }),
    ...overrides,
  };

  return { calls, deps, logs };
}

/** A cron call; `null` sends no `Authorization` header. */
function get(query = '', authorization: null | string = `Bearer ${SECRET}`): Request {
  return new Request(`${URL_BASE}${query}`, {
    headers: authorization === null ? {} : { authorization },
  });
}

describe('isBearer', () => {
  it('accepts exactly "Bearer <secret>"', () => {
    expect(isBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);

    for (const header of [null, '', SECRET, `bearer ${SECRET}`, `Bearer ${SECRET} `, 'Bearer x']) {
      expect(isBearer(header, SECRET)).toBe(false);
    }
  });
});

describe('handleCronRequest', () => {
  it('answers 401 without the cron secret, before anything is built', async () => {
    let built = 0;
    const { calls, deps } = setup({
      maintenance: () => {
        built += 1;

        throw new Error('never');
      },
    });

    for (const request of [get('', null), get('', 'Bearer wrong'), get('?probe=notion', 'x')]) {
      const response = await handleCronRequest(request, deps);

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
    }

    expect(built).toBe(0);
    expect(calls).toEqual([]);
  });

  it('runs the daily routine: 200 when clean, 500 when a sub-step threw', async () => {
    const clean = setup();
    const response = await handleCronRequest(get(), clean.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(okReport);
    expect(clean.calls).toEqual(['run']);

    const failed = setup({}, { ...okReport, failedSteps: ['probe.google'], ok: false });

    const failedResponse = await handleCronRequest(get(), failed.deps);

    expect(failedResponse.status).toBe(500);
  });

  it('runs only the probe that ?probe= names', async () => {
    const { calls, deps } = setup();
    const response = await handleCronRequest(get('?probe=drive'), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ mode: 'existing', ok: true, probe: 'drive' });
    expect(calls).toEqual(['probe:drive']);
  });

  it('refuses an unknown probe', async () => {
    const { calls, deps } = setup();
    const response = await handleCronRequest(get('?probe=gmail'), deps);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'INVALID_PROBE',
      probes: ['drive', 'google', 'notion'],
    });
    expect(calls).toEqual([]);
  });

  it('answers 503 while the configuration is incomplete, and 500 on an unexpected failure', async () => {
    const incomplete = setup({
      maintenance: () => {
        throw new ConfigError(['HEARTBEAT_PING_URL'], []);
      },
    });

    const incompleteResponse = await handleCronRequest(get(), incomplete.deps);

    expect(incompleteResponse.status).toBe(503);

    const broken = setup({
      maintenance: () => ({
        probe: () => Promise.reject(new Error('Redis unreachable')),
        run: () => Promise.reject(new Error('Redis unreachable')),
      }),
    });
    const response = await handleCronRequest(get(), broken.deps);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'CRON_FAILED' });
  });
});
