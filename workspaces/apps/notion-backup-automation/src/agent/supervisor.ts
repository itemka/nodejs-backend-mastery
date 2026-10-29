import type { HealthSnapshot } from '../application/health-snapshot.js';
import type { RateLimiter } from '../application/ports.js';
import type { JobEvent } from '../domain/job-event.js';
import type { AgentModelFailure, BackupJob, Incident, IncidentDecision } from '../domain/job.js';
import { MAX_SUPERVISOR_SUMMARY } from '../domain/job.js';
import type { BackupPolicy } from '../domain/policy.js';
import { abortable } from '../shared/abortable.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { Refusal } from './actions.js';
import { refusal } from './actions.js';
import type { AgentAction, AgentModel, ValidDecision } from './agent-model.js';
import { AgentModelError, parseAgentDecision } from './agent-model.js';
import type { AgentContext } from './context-builder.js';
import { AgentContextError, buildAgentContext } from './context-builder.js';
import type { AgentLimits } from './limits.js';
import {
  DAILY_DECISIONS,
  dailyDecisionLimit,
  MAX_MODEL_FAILURES,
  MIN_DECISION_INTERVAL_MS,
} from './limits.js';
import { cleanFreeText } from './sanitize.js';

/** The longest rationale kept in the job's events. */
const MAX_RATIONALE = 300;

/**
 * Why the supervisor decided without the model, or overruled it:
 * - `decision_budget`, `incident_budget`, `daily_budget`: a budget ran out;
 * - `model_failures`: the model failed `MAX_MODEL_FAILURES` times on the incident;
 * - `context`: the stored state gave no safe context;
 * - `policy`: the model chose an action whose preconditions do not hold.
 */
export type ForcedReason =
  | 'context'
  | 'daily_budget'
  | 'decision_budget'
  | 'incident_budget'
  | 'model_failures'
  | 'policy';

/**
 * One supervisor wakeup's plan, which the tick executes:
 * - `too_soon`: the last decision is less than a minute old, or its `wait` has not ended;
 *   nothing is decided;
 * - `model_failed`: no usable decision; it counts, and the next wakeup asks again;
 * - `act`: exactly one action, from the model or forced (`notify_user`).
 */
export type SupervisorPlan =
  | {
      readonly action: AgentAction;
      readonly confidence?: ValidDecision['confidence'];
      readonly forced?: ForcedReason;
      readonly kind: 'act';
      /** Set when a failed model call forced this hand-over. */
      readonly modelFailure?: AgentModelFailure;
      /** Cleaned, for the events. */
      readonly rationale?: string;
      readonly refused?: Refusal;
    }
  | { readonly failure: AgentModelFailure; readonly kind: 'model_failed' }
  | { readonly kind: 'too_soon'; readonly waitSec: number };

export interface SupervisorOptions {
  readonly clock: Clock;
  /** Counts the decisions per day across every job. */
  readonly limiter: RateLimiter;
  readonly limits: AgentLimits;
  readonly logger: Logger;
  readonly model: AgentModel;
  readonly policy: BackupPolicy;
  /** `NOTION_WORKSPACE_NAME`, redacted from the landmarks. */
  readonly workspaceName?: string | undefined;
}

/**
 * Plans one decision on a job's pending incident: budgets first, then the content-free context,
 * one model call within `AGENT_TIMEOUT_MS`, the schema, and the action policy. It never touches
 * the job: the tick executes the plan and saves it, under its lease.
 */
export class Supervisor {
  readonly limits: AgentLimits;
  private readonly clock: Clock;
  private readonly limiter: RateLimiter;
  private readonly logger: Logger;
  private readonly model: AgentModel;
  private readonly policy: BackupPolicy;
  private readonly workspaceName: string | undefined;

  constructor(options: SupervisorOptions) {
    this.clock = options.clock;
    this.limiter = options.limiter;
    this.limits = options.limits;
    this.logger = options.logger;
    this.model = options.model;
    this.policy = options.policy;
    this.workspaceName = options.workspaceName;
  }

  get modelId(): string {
    return this.model.id;
  }

  /** Whether the next decision needs the recent events and health, which `inspect_status` added. */
  static needsInspection(job: BackupJob): boolean {
    return job.incident?.observations?.inspectedAt !== undefined;
  }

  async plan(
    job: BackupJob,
    inspected: { events: readonly JobEvent[]; health: HealthSnapshot } | undefined,
    signal: AbortSignal,
  ): Promise<SupervisorPlan> {
    const { incident } = job;
    const now = this.clock.now();

    if (incident === undefined) {
      return forced('context', 'The job has no open incident to triage.');
    }

    const resumeAtMs = nextDecisionAt(incident.decisions.at(-1));

    if (now.getTime() < resumeAtMs) {
      return { kind: 'too_soon', waitSec: Math.ceil((resumeAtMs - now.getTime()) / 1000) };
    }

    const budget = this.budgetLeft(job, incident);

    if (budget !== undefined) {
      return budget;
    }

    const daily = await this.limiter.take(DAILY_DECISIONS, dailyDecisionLimit(this.limits));

    if (!daily.allowed) {
      return forced(
        'daily_budget',
        `The supervisor reached its limit of ${this.limits.maxDecisionsPerDay} decisions a day, so it did not triage this incident.`,
      );
    }

    let context: AgentContext;

    try {
      context = buildAgentContext({
        job,
        limits: this.limits,
        now,
        policy: this.policy,
        workspaceName: this.workspaceName,
        ...(inspected === undefined ? {} : { inspected }),
      });
    } catch (error) {
      if (!(error instanceof AgentContextError)) {
        throw error;
      }

      this.logger.warn('agent.context.invalid', { jobId: job.id, reason: error.message });

      return forced('context', 'The supervisor could not build a safe context for this incident.');
    }

    let decision: ValidDecision | undefined;

    try {
      decision = parseAgentDecision(await this.decide(context, signal));
    } catch (error) {
      return this.onModelFailure(job, incident, modelFailureOf(error, signal));
    }

    if (decision === undefined) {
      this.logger.warn('agent.decision.invalid', { jobId: job.id, model: this.model.id });

      return this.onModelFailure(job, incident, 'invalid_output');
    }

    const rationale = cleanFreeText(decision.rationale, MAX_RATIONALE);
    const refused = refusal(decision.action, {
      job,
      limits: this.limits,
      now,
      policy: this.policy,
    });

    this.logger.info('agent.decision', {
      action: decision.action.action,
      confidence: decision.confidence,
      jobId: job.id,
      model: this.model.id,
      ...(refused === undefined ? {} : { refused }),
    });

    if (refused !== undefined) {
      return {
        ...forced(
          'policy',
          `The supervisor proposed ${decision.action.action}, which is not allowed now (${refused}). Its reading: ${rationale}`,
        ),
        confidence: decision.confidence,
        rationale,
        refused,
      };
    }

    const action: AgentAction =
      decision.action.action === 'notify_user'
        ? { action: 'notify_user', summary: summaryText(decision.action.summary) }
        : decision.action;

    return { action, confidence: decision.confidence, kind: 'act', rationale };
  }

  /** A budget that has run out forces the hand-over without a model call. */
  private budgetLeft(job: BackupJob, incident: Incident): SupervisorPlan | undefined {
    const { maxDecisionsPerIncident, maxIncidentsPerJob } = this.limits;

    if (incident.decisions.length >= maxDecisionsPerIncident) {
      return forced(
        'decision_budget',
        `The supervisor used its ${maxDecisionsPerIncident} decisions on this incident without a fix.`,
      );
    }

    if (incident.decisions.length === 0 && (job.supervisedIncidents ?? 0) >= maxIncidentsPerJob) {
      return forced(
        'incident_budget',
        `The supervisor already triaged ${maxIncidentsPerJob} incidents of this job, so this one goes straight to you.`,
      );
    }

    const failures = incident.decisions.filter(({ modelFailure }) => modelFailure !== undefined);

    return failures.length >= MAX_MODEL_FAILURES
      ? forced(
          'model_failures',
          modelFailureSummary(failures.at(-1)?.modelFailure ?? 'unavailable'),
        )
      : undefined;
  }

  private onModelFailure(
    job: BackupJob,
    incident: Incident,
    failure: AgentModelFailure,
  ): SupervisorPlan {
    const failures =
      incident.decisions.filter(({ modelFailure }) => modelFailure !== undefined).length + 1;

    this.logger.warn('agent.model.failed', {
      failure,
      failures,
      jobId: job.id,
      model: this.model.id,
    });

    return failures >= MAX_MODEL_FAILURES
      ? { ...forced('model_failures', modelFailureSummary(failure)), modelFailure: failure }
      : { failure, kind: 'model_failed' };
  }

  /** One model call, ended by `AGENT_TIMEOUT_MS` or the step's own budget. */
  private async decide(context: AgentContext, signal: AbortSignal): Promise<unknown> {
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(this.limits.timeoutMs)]);

    return abortable(this.model.decide(context, callSignal), callSignal);
  }
}

function forced(reason: ForcedReason, summary: string): Extract<SupervisorPlan, { kind: 'act' }> {
  return {
    action: { action: 'notify_user', summary: summaryText(summary) },
    forced: reason,
    kind: 'act',
  };
}

function summaryText(text: string): string {
  return cleanFreeText(text, MAX_SUPERVISOR_SUMMARY);
}

function modelFailureSummary(failure: AgentModelFailure): string {
  const what: Readonly<Record<AgentModelFailure, string>> = {
    invalid_output: 'gave no valid decision',
    rate_limited: 'was rate-limited',
    timeout: 'did not answer in time',
    unavailable: 'was unavailable',
  };

  return `The supervisor model ${what[failure]} twice, so this incident goes to you without triage.`;
}

function modelFailureOf(error: unknown, signal: AbortSignal): AgentModelFailure {
  if (error instanceof AgentModelError) {
    return error.failure;
  }

  if (
    signal.aborted ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
  ) {
    return 'timeout';
  }

  return 'unavailable';
}

/** A minute after the last decision, or the end of its `wait` when that is later. */
function nextDecisionAt(last: IncidentDecision | undefined): number {
  if (last === undefined) {
    return -Infinity;
  }

  const spaced = Date.parse(last.at) + MIN_DECISION_INTERVAL_MS;

  return last.waitUntil === undefined ? spaced : Math.max(spaced, Date.parse(last.waitUntil));
}
