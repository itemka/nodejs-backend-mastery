import { INSPECTED_EVENT_COUNT } from '../../agent/context-builder.js';
import { Supervisor } from '../../agent/supervisor.js';
import { InvalidJobStateError } from '../../domain/domain-errors.js';
import type { JobEvent } from '../../domain/job-event.js';
import { recordSupervisorDecision } from '../../domain/job-lifecycle.js';
import type {
  BackupJob,
  Incident,
  IncidentDecision,
  SupervisorObservations,
} from '../../domain/job.js';
import type { HealthSnapshot } from '../health-snapshot.js';
import type { StoredJob } from '../ports.js';
import type { StepContext, StepResult } from './step-runner.js';
import type { ActionEffect, ActPlan } from './supervisor-actions.js';
import { actionEffect } from './supervisor-actions.js';

/**
 * `supervise`: one supervisor decision on the pending incident (the plan's LLM Supervisor loop):
 * the plan, then exactly one action, saved with the decision and what the action observed. The
 * next tick re-evaluates the deterministic state first.
 */
export async function supervise(ctx: StepContext, current: StoredJob): Promise<StepResult> {
  const { incident } = current.job;

  if (incident === undefined) {
    throw new InvalidJobStateError('UNEXPECTED_STATUS', current.job.status);
  }

  const inspected = Supervisor.needsInspection(current.job)
    ? await inspection(ctx, current.job.id)
    : undefined;
  const plan = await ctx.supervisor.plan(current.job, inspected, ctx.signal);

  switch (plan.kind) {
    case 'too_soon': {
      return { delaySec: plan.waitSec, stored: current };
    }

    case 'model_failed': {
      const stored = await commitDecision(ctx, current, incident, {
        decision: { modelFailure: plan.failure, outcome: 'no_decision' },
      });

      await ctx.store.supervisor(
        current.job.id,
        `supervisor · no decision: the model (${ctx.supervisor.modelId}) failed with ${plan.failure}`,
        incident.code,
      );

      return { stored };
    }

    case 'act': {
      return act(ctx, current, incident, plan);
    }
  }
}

/** Runs the planned action's effect, then saves the decision and the job rule in one write. */
async function act(
  ctx: StepContext,
  current: StoredJob,
  incident: Incident,
  plan: ActPlan,
): Promise<StepResult> {
  const effect = await actionEffect(ctx, current.job, plan);
  const waitUntil =
    effect.delaySec === undefined
      ? undefined
      : new Date(ctx.clock.now().getTime() + effect.delaySec * 1000).toISOString();
  const stored = await commitDecision(ctx, current, incident, {
    decision: {
      action: plan.action.action,
      outcome: effect.outcome,
      ...(plan.modelFailure === undefined ? {} : { modelFailure: plan.modelFailure }),
      ...(waitUntil === undefined ? {} : { waitUntil }),
    },
    ...(effect.detail === undefined ? {} : { detail: effect.detail }),
    ...(effect.observations === undefined ? {} : { observations: effect.observations }),
    ...(effect.apply === undefined ? {} : { apply: effect.apply }),
  });

  await ctx.store.supervisor(
    current.job.id,
    supervisorEventText(plan, effect, ctx.supervisor.modelId),
    incident.code,
  );

  return { stored, ...(effect.delaySec === undefined ? {} : { delaySec: effect.delaySec }) };
}

/**
 * Saves one decision on the incident the plan was made for, then the action's rule. A job
 * whose incident changed meanwhile stops safely (`INCIDENT_CHANGED`).
 */
async function commitDecision(
  ctx: StepContext,
  current: StoredJob,
  incident: Incident,
  change: {
    readonly decision: Omit<IncidentDecision, 'at'>;
    readonly detail?: string;
    readonly observations?: SupervisorObservations;
    readonly apply?: (job: BackupJob, now: Date) => BackupJob;
  },
): Promise<StoredJob> {
  const { apply, decision, detail, observations } = change;

  return ctx.store.commit(
    current,
    (latest) => {
      if (
        latest.incident?.code !== incident.code ||
        latest.incident.openedAt !== incident.openedAt ||
        latest.incident.state !== 'awaiting_supervisor'
      ) {
        throw new InvalidJobStateError('INCIDENT_CHANGED', latest.status);
      }

      const now = ctx.clock.now();
      const recorded = recordSupervisorDecision(latest, now, decision, observations);

      return apply === undefined ? recorded : apply(recorded, now);
    },
    detail,
  );
}

/** The newest events and the probe results, for a context after `inspect_status`. Best effort. */
async function inspection(
  ctx: StepContext,
  jobId: string,
): Promise<{ events: JobEvent[]; health: HealthSnapshot } | undefined> {
  try {
    const [events, health] = await Promise.all([
      ctx.jobs.listEvents(jobId, { limit: INSPECTED_EVENT_COUNT }),
      ctx.health.read(),
    ]);

    return { events, health };
  } catch (error) {
    ctx.log.warn('agent.inspection.failed', { error });

    return undefined;
  }
}

/** One `supervisor` event: the action, who chose it, and the model's cleaned rationale. */
function supervisorEventText(plan: ActPlan, effect: ActionEffect, modelId: string): string {
  const { action } = plan;
  const source =
    plan.forced === undefined
      ? `${modelId}, ${plan.confidence ?? 'unknown'} confidence`
      : `forced: ${plan.forced}`;
  const why = plan.rationale === undefined ? '' : ` · ${plan.rationale}`;

  return `supervisor · ${action.action}${actionParams(action)} → ${effect.outcome} (${source})${why}`;
}

function actionParams(action: ActPlan['action']): string {
  switch (action.action) {
    case 'retry_stage': {
      return ` ${action.stage}`;
    }

    case 'search_email_again': {
      return ` from ${action.widenMinutes} min earlier`;
    }

    case 'wait': {
      return ` ${action.minutes} min`;
    }

    default: {
      return '';
    }
  }
}
