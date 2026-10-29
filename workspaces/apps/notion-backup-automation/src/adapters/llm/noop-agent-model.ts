import type { AgentDecision, AgentModel } from '../../agent/agent-model.js';
import type { AgentContext } from '../../agent/context-builder.js';

/** What `NoopAgentModel` tells you beside the incident's own reason and fix. */
export const NOOP_SUMMARY =
  'No supervisor model is configured (AGENT_MODEL_PROVIDER=none), so this incident was not triaged.';

/**
 * `AGENT_MODEL_PROVIDER=none`: every incident goes to you after one decision, with no model
 * call. The app works the same without an LLM.
 */
export class NoopAgentModel implements AgentModel {
  readonly id = 'none';

  decide(_context: AgentContext, _signal: AbortSignal): Promise<AgentDecision> {
    return Promise.resolve({
      action: 'notify_user',
      confidence: 'high',
      params: { summary: NOOP_SUMMARY },
      rationale: 'No supervisor model is configured.',
    });
  }
}
