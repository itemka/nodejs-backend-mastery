import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import type { AgentModel } from '../../src/agent/agent-model.js';
import { AgentModelError, parseAgentDecision } from '../../src/agent/agent-model.js';
import type { AgentContext } from '../../src/agent/context-builder.js';
import { createAgentModel } from '../../src/config/control-containers.js';
import { agentEnvSchema, loadEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/shared/logger.js';
import { describeAction, fixtureMiss, loadAgentFixtures } from '../support/agent-fixtures.js';

/*
 * Opt-in: `pnpm --filter notion-backup-automation test:agent-live` (sets NBA_LIVE_AGENT=1). The
 * S5 evaluation: the 7 fixture incidents go to the configured model (`AGENT_MODEL_NAME`, with
 * `GEMINI_API_KEY` from `.env.local`; a variable set in the shell wins). Every answer must be
 * schema-valid, and at least 6 of 7 acceptable. It sends only the fixtures' made-up,
 * content-free contexts: 7 requests, nothing else.
 */
const enabled = process.env.NBA_LIVE_AGENT === '1';
const envFile = path.resolve(import.meta.dirname, '../../.env.local');

if (enabled && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const MIN_ACCEPTABLE = 6;
/**
 * Production asks at most once a minute; back-to-back calls trip the free tier's per-minute
 * limit (429) or a busy model (503). So the calls are spaced, and a 429 or 503 is asked again
 * once after a pause: S5 scores the answers, not the quota.
 */
const GAP_MS = 13_000;
const RETRY_AFTER_MS = 30_000;

async function decideWithOneRetry(
  model: AgentModel,
  context: AgentContext,
  timeoutMs: number,
): Promise<unknown> {
  try {
    return await model.decide(context, AbortSignal.timeout(timeoutMs));
  } catch (error) {
    if (!(error instanceof AgentModelError) || ![429, 503].includes(error.status ?? 0)) {
      throw error;
    }

    await sleep(RETRY_AFTER_MS);

    return model.decide(context, AbortSignal.timeout(timeoutMs));
  }
}

describe.runIf(enabled)('live supervisor decisions (S5)', () => {
  it('answers every fixture validly, and acceptably for at least 6 of 7', async () => {
    const env = loadEnv(agentEnvSchema, process.env);

    if (env.AGENT_MODEL_PROVIDER !== 'gemini') {
      throw new Error('test:agent-live evaluates Gemini: set AGENT_MODEL_PROVIDER=gemini');
    }

    const model = createAgentModel(env, { logger: createLogger({ level: 'warn' }) });

    if (model === undefined) {
      throw new Error('GEMINI_API_KEY is not set (copy it from 1Password into .env.local)');
    }

    const fixtures = loadAgentFixtures();
    const lines: string[] = [];
    let valid = 0;
    let acceptable = 0;

    for (const fixture of fixtures) {
      if (lines.length > 0) {
        await sleep(GAP_MS);
      }

      const started = performance.now();
      let raw: unknown;

      try {
        raw = await decideWithOneRetry(model, fixture.context, env.AGENT_TIMEOUT_MS);
      } catch (error) {
        raw = undefined;
        lines.push(
          `✗ ${fixture.name}: no decision (${error instanceof Error ? error.message : 'error'})`,
        );

        continue;
      }

      const decision = parseAgentDecision(raw);
      const ms = Math.round(performance.now() - started);

      if (decision === undefined) {
        lines.push(`✗ ${fixture.name}: invalid output ${JSON.stringify(raw).slice(0, 200)}`);

        continue;
      }

      valid += 1;

      // The action and its parameters, as production's policy would check them.
      const miss = fixtureMiss(fixture, decision.action);
      const mark = miss === undefined ? '✓' : `✗ [${miss}]`;

      acceptable += miss === undefined ? 1 : 0;
      lines.push(
        `${mark} ${fixture.name}: ${describeAction(decision.action)} (${decision.confidence}, ${ms} ms; acceptable: ${fixture.acceptable.join(', ')}) · ${decision.rationale.slice(0, 160)}`,
      );
    }

    console.info(
      [
        `model ${model.id}`,
        ...lines,
        `valid ${valid}/${fixtures.length}, acceptable ${acceptable}/${fixtures.length}`,
      ].join('\n'),
    );

    expect(valid).toBe(fixtures.length);
    expect(acceptable).toBeGreaterThanOrEqual(MIN_ACCEPTABLE);
  }, 900_000);
});
