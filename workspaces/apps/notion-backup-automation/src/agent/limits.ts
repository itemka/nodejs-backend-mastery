import type { RateLimit } from '../application/ports.js';

/** The supervisor's budgets. Production values come from the `AGENT_*` env variables. */
export interface AgentLimits {
  /** `AGENT_MAX_DECISIONS_PER_DAY`: model decisions across every job, per UTC day. */
  readonly maxDecisionsPerDay: number;
  /** `AGENT_MAX_DECISIONS_PER_INCIDENT`: the last one may only hand the incident to you. */
  readonly maxDecisionsPerIncident: number;
  /** `AGENT_MAX_INCIDENTS_PER_JOB`: later incidents go straight to you. */
  readonly maxIncidentsPerJob: number;
  /** `AGENT_TIMEOUT_MS`: one model call. */
  readonly timeoutMs: number;
}

export const defaultAgentLimits: AgentLimits = {
  maxDecisionsPerDay: 20,
  maxDecisionsPerIncident: 4,
  maxIncidentsPerJob: 3,
  timeoutMs: 20_000,
};

/** One decision per wakeup, and wakeups at least a minute apart. */
export const MIN_DECISION_INTERVAL_MS = 60_000;

/** After this many failed model calls on an incident, it goes to you without another call. */
export const MAX_MODEL_FAILURES = 2;

/** `check_notion_session` probes at most this often per incident. */
export const SESSION_PROBE_INTERVAL_MS = 30 * 60_000;

/** `retry` starts a new export attempt only this long after the last export click. */
export const MIN_NEW_ATTEMPT_AFTER_CLICK_MS = 2 * 60 * 60_000;

/** The supervisor's own wakeup choices, in minutes. */
export const WAIT_MINUTES = [15, 60, 240] as const;

/** How much earlier `search_email_again` starts the search, in minutes. */
export const WIDEN_MINUTES = [60, 180] as const;

/** The daily decision counter's name in the rate limiter. */
export const DAILY_DECISIONS = 'agent:decisions';

export function dailyDecisionLimit(limits: AgentLimits): RateLimit {
  return { limit: limits.maxDecisionsPerDay, windowSec: 24 * 60 * 60 };
}
