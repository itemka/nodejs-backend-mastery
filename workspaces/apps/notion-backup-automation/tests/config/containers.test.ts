import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SuccessNotification } from '../../src/application/ports.js';
import type { NotifierEnv } from '../../src/config/containers.js';
import { agentLimitsFrom, createAgentModel, createNotifier } from '../../src/config/containers.js';
import {
  agentCheckTimeoutMs,
  MAX_AGENT_CHECK_TIMEOUT_MS,
} from '../../src/config/control-containers.js';
import { agentEnvSchema, loadEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/shared/logger.js';
import { FAKE_HUB_URL, fakeHubToken, FakeTelegram } from '../support/fake-telegram.js';

const success: SuccessNotification = {
  driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
  durationMs: 60_000,
  entryCount: 198,
  fileName: 'notion-workspace-2026-10-01.zip',
  folder: '2026',
  jobId: '2026-10',
  period: '2026-10',
  sizeBytes: 8_907_221,
};

const base: NotifierEnv = {
  APP_ENV: 'prod',
  BACKUP_TIME_ZONE: 'Europe/Warsaw',
  NOTIFIERS: ['console'],
};

function notifierFor(env: NotifierEnv) {
  const telegram = new FakeTelegram();
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger({
    sink: (_level, line) => {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });

  return { logs, notifier: createNotifier(env, { fetch: telegram.fetch, logger }), telegram };
}

describe('createAgentModel', () => {
  const agentEnv = loadEnv(agentEnvSchema, {});
  const logger = createLogger({ level: 'error' });

  it('builds Gemini with the key, none without an LLM, and nothing for gemini without a key', () => {
    expect(
      createAgentModel({ ...agentEnv, GEMINI_API_KEY: 'gemini-key-value-1234' }, { logger })?.id,
    ).toBe('gemini:gemini-3.6-flash');
    expect(createAgentModel({ ...agentEnv, AGENT_MODEL_PROVIDER: 'none' }, { logger })?.id).toBe(
      'none',
    );
    expect(createAgentModel(agentEnv, { logger })).toBeUndefined();
  });

  it('reads the budgets from the AGENT_* variables', () => {
    expect(agentLimitsFrom({ ...agentEnv, AGENT_TIMEOUT_MS: 5000 })).toEqual({
      maxDecisionsPerDay: 20,
      maxDecisionsPerIncident: 4,
      maxIncidentsPerJob: 3,
      timeoutMs: 5000,
    });
  });

  it('caps checkAgent at 20 s, inside the maxDuration of /mcp, whatever AGENT_TIMEOUT_MS is', () => {
    const vercel = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../vercel.json'), 'utf8'),
    ) as { functions: Record<string, { maxDuration: number }> };

    expect(agentCheckTimeoutMs({ AGENT_TIMEOUT_MS: 60_000 })).toBe(20_000);
    expect(agentCheckTimeoutMs({ AGENT_TIMEOUT_MS: 5000 })).toBe(5000);
    // Room left for the model's setup and saving the result before Vercel ends the function.
    expect(MAX_AGENT_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(
      vercel.functions['api/mcp.ts']!.maxDuration * 1000 - 10_000,
    );
  });
});

describe('createNotifier', () => {
  it('notifies through the console only by default', async () => {
    const { logs, notifier, telegram } = notifierFor(base);

    await notifier.success(success);

    expect(logs.map(({ event }) => event)).toEqual(['notify.success']);
    expect(telegram.calls).toEqual([]);
  });

  it('adds Telegram when it is listed and configured', async () => {
    const { logs, notifier, telegram } = notifierFor({
      ...base,
      NOTIFIERS: ['console', 'telegram'],
      TELEGRAM_HUB_TOKEN: fakeHubToken,
      TELEGRAM_HUB_URL: FAKE_HUB_URL,
    });

    await notifier.success(success);

    expect(logs.map(({ event }) => event)).toEqual(['notify.success']);
    expect(telegram.sentMessages()).toEqual([
      expect.objectContaining({ html: expect.stringContaining('Notion backup stored') }),
    ]);
  });

  it('leaves Telegram out, with a warning naming what is missing, when it is not configured', async () => {
    const { logs, notifier, telegram } = notifierFor({
      ...base,
      NOTIFIERS: ['console', 'telegram'],
      TELEGRAM_HUB_TOKEN: fakeHubToken,
    });

    await notifier.success(success);

    expect(logs).toEqual([
      expect.objectContaining({
        event: 'notify.telegram.unconfigured',
        missing: ['TELEGRAM_HUB_URL'],
      }),
      expect.objectContaining({ event: 'notify.success' }),
    ]);
    expect(telegram.calls).toEqual([]);
  });
});
