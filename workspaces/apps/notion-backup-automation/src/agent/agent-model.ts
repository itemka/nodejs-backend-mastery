import { z } from 'zod';

import type { AgentActionName, AgentModelFailure } from '../domain/job.js';
import { agentActionNames } from '../domain/job.js';
import type { Stage } from '../domain/statuses.js';
import { stageSchema } from '../domain/statuses.js';
import type { AgentContext } from './context-builder.js';
import { WAIT_MINUTES, WIDEN_MINUTES } from './limits.js';

/** Free text from the model is bounded here, and clipped further before it is stored. */
const MAX_MODEL_TEXT = 2000;

/**
 * What a model answers: one action of the closed set, its parameters, why, and how sure. The
 * parameters are one flat object, so every model can follow the schema; `parseAgentDecision`
 * then checks the ones the action needs.
 */
export const agentDecisionSchema = z.object({
  action: z.enum(agentActionNames).describe('Exactly one of allowedActions'),
  confidence: z.enum(['low', 'medium', 'high']),
  params: z
    .object({
      minutes: z.number().int().optional().describe('wait only: 15, 60 or 240'),
      stage: stageSchema.optional().describe('retry_stage only: the job stage'),
      summary: z
        .string()
        .max(MAX_MODEL_TEXT)
        .optional()
        .describe(
          'notify_user only: a diagnosis and next step for the owner, plain text, at most 400 characters',
        ),
      widenMinutes: z.number().int().optional().describe('search_email_again only: 60 or 180'),
    })
    .describe('Only the parameters the chosen action needs'),
  rationale: z
    .string()
    .max(MAX_MODEL_TEXT)
    .describe('Why this action, in at most 300 characters, citing only the context'),
});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

const actionParams = {
  check_notion_session: z.object({}),
  inspect_status: z.object({}),
  notify_user: z.object({ summary: z.string().trim().min(1) }),
  retry: z.object({}),
  retry_stage: z.object({ stage: stageSchema }),
  search_email_again: z.object({ widenMinutes: z.literal(WIDEN_MINUTES) }),
  wait: z.object({ minutes: z.literal(WAIT_MINUTES) }),
} as const satisfies Record<AgentActionName, z.ZodType>;

/** One action with exactly the parameters it needs. */
export type AgentAction =
  | { readonly action: 'check_notion_session' }
  | { readonly action: 'inspect_status' }
  | { readonly action: 'notify_user'; readonly summary: string }
  | { readonly action: 'retry' }
  | { readonly action: 'retry_stage'; readonly stage: Stage }
  | { readonly action: 'search_email_again'; readonly widenMinutes: (typeof WIDEN_MINUTES)[number] }
  | { readonly action: 'wait'; readonly minutes: (typeof WAIT_MINUTES)[number] };

export interface ValidDecision {
  readonly action: AgentAction;
  readonly confidence: AgentDecision['confidence'];
  readonly rationale: string;
}

/**
 * A model's raw answer as a typed action, or undefined when it does not match the schema or
 * lacks a parameter its action needs. Parameters other actions use are ignored.
 */
export function parseAgentDecision(raw: unknown): ValidDecision | undefined {
  const decision = agentDecisionSchema.safeParse(raw);

  if (!decision.success) {
    return undefined;
  }

  const { action, confidence, params, rationale } = decision.data;
  const parsed = actionParams[action].safeParse(params);

  if (!parsed.success) {
    return undefined;
  }

  return { action: { ...parsed.data, action } as AgentAction, confidence, rationale };
}

/**
 * The model's view of the decision schema, as JSON Schema: no `$schema` and no
 * `additionalProperties`, which some models' structured output rejects.
 */
export function agentDecisionJsonSchema(): Record<string, unknown> {
  return stripKeys(
    z.toJSONSchema(agentDecisionSchema),
    new Set(['$schema', 'additionalProperties']),
  );
}

function stripKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  const entries = Object.entries(value)
    .filter(([key]) => !keys.has(key))
    .map(([key, child]) => [key, stripChild(child, keys)]);

  return Object.fromEntries(entries) as Record<string, unknown>;
}

function stripChild(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripChild(item, keys));
  }

  return typeof value === 'object' && value !== null
    ? stripKeys(value as Record<string, unknown>, keys)
    : value;
}

/** A model call that gave no usable decision; it counts against the incident's budget. */
export class AgentModelError extends Error {
  readonly failure: AgentModelFailure;
  /** The HTTP status, when the provider answered with one. */
  readonly status: number | undefined;

  constructor(failure: AgentModelFailure, detail: string, status?: number) {
    super(detail);
    this.name = 'AgentModelError';
    this.failure = failure;
    this.status = status;
  }
}

/**
 * The supervisor's model. `decide` returns the model's raw answer, which the supervisor
 * validates; it throws `AgentModelError` (or rejects with the signal's reason) when it has none.
 */
export interface AgentModel {
  /** `gemini:gemini-3.6-flash`, or `none`. */
  readonly id: string;
  decide(context: AgentContext, signal: AbortSignal): Promise<unknown>;
}
