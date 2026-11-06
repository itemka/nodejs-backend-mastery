import { MIN_NEW_ATTEMPT_AFTER_CLICK_MS } from '../../agent/limits.js';
import type { SupervisorPlan } from '../../agent/supervisor.js';
import type { ErrorCode } from '../../domain/error-catalog.js';
import { errorCatalog } from '../../domain/error-catalog.js';
import {
  handOverToUser,
  replaceIncident,
  supervisorNewAttempt,
  supervisorRetryStage,
} from '../../domain/job-lifecycle.js';
import type { BackupJob, SupervisorObservations } from '../../domain/job.js';
import type { ExportEmailSearchResult } from '../ports.js';
import type { StepContext } from './step-runner.js';
import { failureCode } from './step-runner.js';

export type ActPlan = Extract<SupervisorPlan, { kind: 'act' }>;

type SupervisorAction = ActPlan['action'];

/** What a supervisor action did: the decision's outcome, its observations, and the job rule. */
export interface ActionEffect {
  readonly delaySec?: number;
  /** The transition's event detail, when the rule changes the status. */
  readonly detail?: string;
  readonly observations?: SupervisorObservations;
  readonly outcome: string;
  readonly apply?: (job: BackupJob, now: Date) => BackupJob;
}

/** One action's run, given the action's own parameters. */
type ActionRun<K extends SupervisorAction['action']> = (
  ctx: StepContext,
  run: {
    readonly action: Extract<SupervisorAction, { action: K }>;
    /** The decision's time, for the observations. */
    readonly at: string;
    readonly job: BackupJob;
    readonly plan: ActPlan;
  },
) => ActionEffect | Promise<ActionEffect>;

/** The bounded actions the supervisor can choose, by name. */
const supervisorActions: { readonly [K in SupervisorAction['action']]: ActionRun<K> } = {
  check_notion_session: async (ctx, { at }) => {
    const code = await failureCode(
      ctx,
      () => ctx.trigger.probeSession(ctx.signal),
      'NOTION_UNAVAILABLE',
    );
    const state = notionStateFor(code);

    return {
      observations: { notionSession: { checkedAt: at, state } },
      outcome: `session:${state}`,
      ...replacedBy(code),
    };
  },

  inspect_status: (_ctx, { at }) => ({ observations: { inspectedAt: at }, outcome: 'inspected' }),

  notify_user: (_ctx, { action, plan }) => ({
    apply: (latest, now) => handOverToUser(latest, now, action.summary),
    outcome: plan.forced === undefined ? 'handed_over' : `forced:${plan.forced}`,
  }),

  retry: (ctx) => ({
    apply: (latest, now) =>
      supervisorNewAttempt(latest, now, ctx.policy, MIN_NEW_ATTEMPT_AFTER_CLICK_MS),
    detail: 'supervisor retry',
    outcome: 'new_attempt',
  }),

  retry_stage: (ctx) => ({
    apply: (latest, now) => supervisorRetryStage(latest, now, ctx.policy),
    detail: 'supervisor retry_stage',
    outcome: 'retrying',
  }),

  search_email_again: (ctx, { action, at, job }) =>
    searchEmailAgain(ctx, job, action.widenMinutes, at),

  wait: (_ctx, { action }) => ({
    delaySec: action.minutes * 60,
    outcome: `wait:${action.minutes}m`,
  }),
};

/** Runs the planned action and reports its effect; nothing is saved here. */
export async function actionEffect(
  ctx: StepContext,
  job: BackupJob,
  plan: ActPlan,
): Promise<ActionEffect> {
  const { action } = plan;
  // TypeScript cannot pair a union key with its own handler; the table's type does.
  const run = supervisorActions[action.action] as ActionRun<typeof action.action>;

  return run(ctx, { action, at: ctx.clock.now().toISOString(), job, plan });
}

/** The Gmail match again, from `widenMinutes` earlier; only counts and reasons are kept. */
async function searchEmailAgain(
  ctx: StepContext,
  job: BackupJob,
  widenMinutes: 60 | 180,
  at: string,
): Promise<ActionEffect> {
  const requestedAt = Date.parse(job.requestedAt ?? job.createdAt);
  const requestedAfter = new Date(requestedAt - widenMinutes * 60_000);
  let result: ExportEmailSearchResult | undefined;
  const code = await failureCode(
    ctx,
    async () => {
      result = await ctx.emails.findReadyEmail({ excludeIds: [], requestedAfter });
    },
    'GMAIL_UNAVAILABLE',
  );

  if (result === undefined) {
    const failed = code ?? 'UNKNOWN_ERROR';

    return {
      observations: {
        emailSearch: { at, candidates: 0, code: failed, rejected: {}, widenMinutes },
      },
      outcome: `search_failed:${failed}`,
      ...replacedBy(failed),
    };
  }

  const found = result.status === 'found';

  return {
    observations: {
      emailSearch: {
        at,
        candidates: found ? 1 : 0,
        rejected: result.status === 'found' ? {} : { ...result.rejected },
        widenMinutes,
      },
    },
    outcome: found ? 'email_found' : 'no_email',
  };
}

/**
 * A supervisor action found a cause the deterministic classifier knows and never supervises,
 * such as an expired Notion session: the incident becomes that code's and waits for you.
 */
function replacedBy(code: ErrorCode | undefined): Pick<ActionEffect, 'apply' | 'detail'> {
  if (code === undefined || errorCatalog[code].supervised) {
    return {};
  }

  return { apply: (job, now) => replaceIncident(job, now, code), detail: code };
}

const notionStates: Partial<
  Record<ErrorCode, NonNullable<SupervisorObservations['notionSession']>['state']>
> = {
  NOTION_INTERACTIVE_CHALLENGE: 'challenge',
  NOTION_SESSION_EXPIRED: 'expired',
  NOTION_WRONG_WORKSPACE: 'wrong_workspace',
};

/** The session probe's result as the supervisor sees it: valid, a known problem, or an error. */
function notionStateFor(
  code: ErrorCode | undefined,
): NonNullable<SupervisorObservations['notionSession']>['state'] {
  return code === undefined ? 'valid' : (notionStates[code] ?? 'error');
}
