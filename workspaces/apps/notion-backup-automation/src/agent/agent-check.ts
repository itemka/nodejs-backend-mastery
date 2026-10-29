import type { AgentModelFailure } from '../domain/job.js';
import { abortable } from '../shared/abortable.js';
import type { Clock } from '../shared/clock.js';
import type { AgentModel } from './agent-model.js';
import { AgentModelError, parseAgentDecision } from './agent-model.js';
import type { AgentContext } from './context-builder.js';

/**
 * The deployed smoke test's incident: a made-up, content-free `UNKNOWN_ERROR` in the Notion
 * stage of a job that does not exist. Any valid decision passes; nothing is executed.
 */
export const AGENT_CHECK_CONTEXT: AgentContext = {
  allowedActions: [
    'inspect_status',
    'check_notion_session',
    'wait',
    'retry_stage',
    'retry',
    'notify_user',
  ],
  incident: {
    category: 'unknown',
    code: 'UNKNOWN_ERROR',
    decisions: [],
    decisionsRemaining: 4,
    description: 'An unexpected error occurred.',
    occurrences: 1,
  },
  job: {
    ageHours: 0.1,
    emailCheckAttempt: 0,
    exportAttempt: 1,
    exportClickAt: false,
    jobId: '2000-01',
    maxExportAttempts: 3,
    maxLifetimeHours: 168,
    period: '2000-01',
    stage: 'NOTION_TRIGGER',
    stageRetries: {},
    status: 'NEEDS_ATTENTION',
  },
  limits: { maxDecisionsPerIncident: 4, maxStageRetries: 3 },
  observations: {},
};

/**
 * - `not_configured`: `gemini` without `GEMINI_API_KEY`, so nothing was called;
 * - a model failure: the call gave no valid decision.
 */
export type AgentCheckFailure = AgentModelFailure | 'not_configured';

export interface AgentCheckResult {
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly failure?: AgentCheckFailure;
  readonly model: string;
  readonly ok: boolean;
}

/** `backup_health({ checkAgent: true })`: one canned decision within `timeoutMs`. */
export async function runAgentCheck(
  model: AgentModel | undefined,
  { clock, modelId, timeoutMs }: { clock: Clock; modelId: string; timeoutMs: number },
): Promise<AgentCheckResult> {
  const started = clock.now();
  const result = (failure?: AgentCheckFailure): AgentCheckResult => ({
    checkedAt: started.toISOString(),
    durationMs: Math.max(0, clock.now().getTime() - started.getTime()),
    model: modelId,
    ok: failure === undefined,
    ...(failure === undefined ? {} : { failure }),
  });

  if (model === undefined) {
    return result('not_configured');
  }

  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const raw = await abortable(model.decide(AGENT_CHECK_CONTEXT, signal), signal);

    return result(parseAgentDecision(raw) === undefined ? 'invalid_output' : undefined);
  } catch (error) {
    if (error instanceof AgentModelError) {
      return result(error.failure);
    }

    return result(signal.aborted ? 'timeout' : 'unavailable');
  }
}
