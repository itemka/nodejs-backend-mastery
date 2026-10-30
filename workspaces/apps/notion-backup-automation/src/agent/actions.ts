import type { AgentActionName, BackupJob, Incident } from '../domain/job.js';
import { agentActionNames } from '../domain/job.js';
import type { BackupPolicy } from '../domain/policy.js';
import type { Stage } from '../domain/statuses.js';
import type { AgentAction } from './agent-model.js';
import type { AgentLimits } from './limits.js';
import {
  MIN_NEW_ATTEMPT_AFTER_CLICK_MS,
  SESSION_PROBE_INTERVAL_MS,
  WAIT_MINUTES,
  WIDEN_MINUTES,
} from './limits.js';

const HOUR_MS = 60 * 60_000;

/** What `ActionPolicy` checks an action against: the stored job, while the tick holds its lease. */
export interface PolicyInput {
  readonly job: BackupJob;
  readonly limits: AgentLimits;
  readonly now: Date;
  readonly policy: BackupPolicy;
}

/** Why an action is not allowed now; the supervisor then hands the incident to you instead. */
export type Refusal =
  | 'already_inspected'
  | 'attempts_exhausted'
  | 'export_clicked'
  | 'last_decision'
  | 'no_incident'
  | 'not_requested'
  | 'past_lifetime'
  | 'probed_recently'
  | 'stage_mismatch'
  | 'stage_retries_exhausted'
  | 'too_soon_after_click'
  | 'wrong_stage';

/** Decisions the incident still allows, this one included. */
export function decisionsRemaining(incident: Incident, limits: AgentLimits): number {
  return Math.max(0, limits.maxDecisionsPerIncident - incident.decisions.length);
}

/**
 * The deterministic preconditions of each action (the plan's action table). `notify_user` is
 * always allowed, and the incident's last decision may only be `notify_user`, so supervision
 * always ends with you told.
 */
export function refusal(action: AgentAction, input: PolicyInput): Refusal | undefined {
  const { incident } = input.job;

  if (incident === undefined) {
    return action.action === 'notify_user' ? undefined : 'no_incident';
  }

  if (action.action === 'notify_user') {
    return undefined;
  }

  if (decisionsRemaining(incident, input.limits) <= 1) {
    return 'last_decision';
  }

  return actionRefusal(action, incident, input);
}

/** Each action's own preconditions, past the rules every action shares. */
function actionRefusal(
  action: Exclude<AgentAction, { readonly action: 'notify_user' }>,
  incident: Incident,
  { job, now, policy }: PolicyInput,
): Refusal | undefined {
  switch (action.action) {
    case 'check_notion_session': {
      return sessionProbeRefusal(incident, now);
    }

    case 'inspect_status': {
      return incident.observations?.inspectedAt === undefined ? undefined : 'already_inspected';
    }

    case 'retry': {
      return newAttemptRefusal(job, now, policy);
    }

    case 'retry_stage': {
      return stageRetryRefusal(action.stage, incident, job, policy);
    }

    case 'search_email_again': {
      return incident.stage === 'EMAIL_WAIT' ? undefined : 'wrong_stage';
    }

    case 'wait': {
      const lifetimeEndsMs = Date.parse(job.createdAt) + policy.jobMaxLifetimeHours * HOUR_MS;

      return now.getTime() + action.minutes * 60_000 < lifetimeEndsMs ? undefined : 'past_lifetime';
    }
  }
}

/** Only in NOTION_TRIGGER, and not twice within 30 minutes. */
function sessionProbeRefusal(incident: Incident, now: Date): Refusal | undefined {
  if (incident.stage !== 'NOTION_TRIGGER') {
    return 'wrong_stage';
  }

  const checkedAt = incident.observations?.notionSession?.checkedAt;

  return checkedAt !== undefined &&
    now.getTime() - Date.parse(checkedAt) < SESSION_PROBE_INTERVAL_MS
    ? 'probed_recently'
    : undefined;
}

/** Attempts left, an export requested in this attempt, and 2 h since that request. */
function newAttemptRefusal(job: BackupJob, now: Date, policy: BackupPolicy): Refusal | undefined {
  if (job.exportAttempt >= policy.maxExportAttempts) {
    return 'attempts_exhausted';
  }

  // An attempt that requested nothing yet is retried with retry_stage, not given up.
  const clickedAt = job.exportClickAt ?? job.requestedAt;

  if (clickedAt === undefined) {
    return 'not_requested';
  }

  return now.getTime() - Date.parse(clickedAt) < MIN_NEW_ATTEMPT_AFTER_CLICK_MS
    ? 'too_soon_after_click'
    : undefined;
}

/** The incident's own stage, with retries left, and never NOTION_TRIGGER after the click. */
function stageRetryRefusal(
  stage: Stage,
  incident: Incident,
  job: BackupJob,
  policy: BackupPolicy,
): Refusal | undefined {
  if (stage !== incident.stage) {
    return 'stage_mismatch';
  }

  if ((job.stageRetries[incident.stage] ?? 0) >= policy.maxStageRetries) {
    return 'stage_retries_exhausted';
  }

  // Write-ahead: an attempt whose Export was clicked never clicks again.
  return incident.stage === 'NOTION_TRIGGER' && job.exportClickAt !== undefined
    ? 'export_clicked'
    : undefined;
}

/** The actions with at least one allowed form now, in the closed set's order. */
export function allowedActions(input: PolicyInput): AgentActionName[] {
  const stage = input.job.incident?.stage ?? 'NOTION_TRIGGER';
  const candidates: Readonly<Record<AgentActionName, AgentAction>> = {
    check_notion_session: { action: 'check_notion_session' },
    inspect_status: { action: 'inspect_status' },
    notify_user: { action: 'notify_user', summary: '-' },
    retry: { action: 'retry' },
    retry_stage: { action: 'retry_stage', stage },
    search_email_again: { action: 'search_email_again', widenMinutes: WIDEN_MINUTES[0] },
    wait: { action: 'wait', minutes: WAIT_MINUTES[0] },
  };

  return agentActionNames.filter((name) => refusal(candidates[name], input) === undefined);
}
