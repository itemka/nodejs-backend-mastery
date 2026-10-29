import { z } from 'zod';

import type { HealthSnapshot } from '../application/health-snapshot.js';
import { errorCatalog, errorCodeSchema } from '../domain/error-catalog.js';
import type { JobEvent } from '../domain/job-event.js';
import type { BackupJob, IncidentDecision } from '../domain/job.js';
import {
  agentActionNames,
  exportEmailRejections,
  MAX_INCIDENT_DECISIONS,
  MAX_UI_LANDMARK_LENGTH,
  MAX_UI_LANDMARKS,
  stageOf,
  supervisorObservationsSchema,
} from '../domain/job.js';
import { jobIdSchema } from '../domain/naming.js';
import { periodSchema } from '../domain/period.js';
import type { BackupPolicy } from '../domain/policy.js';
import { jobStatusSchema, stageSchema } from '../domain/statuses.js';
import type { PolicyInput } from './actions.js';
import { allowedActions, decisionsRemaining } from './actions.js';
import type { AgentLimits } from './limits.js';
import { sanitizeLandmarks } from './sanitize.js';

/*
 * The model's whole view of an incident, built field by field from an allowlist. It holds codes,
 * counts, flags, catalog text and redacted ARIA names; no screenshot, page text, URL, email,
 * workspace content, cookie or token. Anything the app did not write itself is filtered first,
 * and the result must pass the strict schema, so a field added by mistake fails closed. Events
 * go without their text, which can hold a caller's words (`backup_start`'s reason).
 */

/** `inspect_status` adds the newest events, at most this many. */
export const INSPECTED_EVENT_COUNT = 20;

const count = z.number().int().min(0);
const timestamp = z.iso.datetime();
const outcomeSchema = z.string().regex(/^[\w:-]{1,40}$/);
const probeResult = z.union([z.literal('ok'), errorCodeSchema]);
const notionStateSchema = supervisorObservationsSchema.shape.notionSession.unwrap().shape.state;

export const agentContextSchema = z.strictObject({
  allowedActions: z.array(z.enum(agentActionNames)).min(1),
  incident: z.strictObject({
    /** `transient`: a retried failure whose retries ran out; `unknown`: anything else supervised. */
    category: z.enum(['transient', 'unknown']),
    code: errorCodeSchema,
    decisions: z
      .array(
        z.strictObject({ action: z.enum(agentActionNames).optional(), outcome: outcomeSchema }),
      )
      .max(MAX_INCIDENT_DECISIONS),
    decisionsRemaining: count,
    /** The error catalog's static text for the code. */
    description: z.string().max(400),
    occurrences: z.number().int().min(1),
  }),
  job: z.strictObject({
    ageHours: z.number().min(0),
    emailCheckAttempt: count,
    exportAttempt: z.number().int().min(1),
    /** Whether this attempt clicked Export: then NOTION_TRIGGER is never retried in it. */
    exportClickAt: z.boolean(),
    jobId: jobIdSchema,
    maxExportAttempts: z.number().int().min(1),
    maxLifetimeHours: z.number().int().min(1),
    period: periodSchema,
    stage: stageSchema,
    stageRetries: z.partialRecord(stageSchema, count),
    status: jobStatusSchema,
  }),
  limits: z.strictObject({ maxDecisionsPerIncident: count, maxStageRetries: count }),
  observations: z.strictObject({
    emailSearch: z
      .strictObject({
        candidates: count,
        failedWith: errorCodeSchema.optional(),
        rejected: z.partialRecord(z.enum(exportEmailRejections), count),
        widenMinutes: count,
      })
      .optional(),
    health: z
      .strictObject({
        drive: probeResult.optional(),
        google: probeResult.optional(),
        lastCronOk: z.boolean().optional(),
        notionSession: z.enum(['valid', 'expired', 'challenge', 'missing', 'error']).optional(),
      })
      .optional(),
    notionSession: notionStateSchema.optional(),
    recentEvents: z
      .array(
        z.strictObject({
          at: timestamp,
          code: errorCodeSchema.optional(),
          status: jobStatusSchema.optional(),
          type: z.enum(['transition', 'notification', 'note', 'supervisor']),
        }),
      )
      .max(INSPECTED_EVENT_COUNT)
      .optional(),
    uiLandmarks: z.array(z.string().max(MAX_UI_LANDMARK_LENGTH)).max(MAX_UI_LANDMARKS).optional(),
  }),
});

export type AgentContext = z.infer<typeof agentContextSchema>;

/** The stored state could not be turned into a safe context; the incident then goes to you. */
export class AgentContextError extends Error {
  constructor(reason: string) {
    super(`The supervisor context is invalid: ${reason}`);
    this.name = 'AgentContextError';
  }
}

export interface ContextInput {
  /** Read only after `inspect_status` ran on the incident. */
  readonly inspected?: { readonly events: readonly JobEvent[]; readonly health: HealthSnapshot };
  readonly job: BackupJob;
  readonly limits: AgentLimits;
  readonly now: Date;
  readonly policy: BackupPolicy;
  /** Redacted from the landmarks. */
  readonly workspaceName?: string | undefined;
}

/** The context for one decision on the job's incident; throws `AgentContextError` if unsafe. */
export function buildAgentContext(input: ContextInput): AgentContext {
  const { job, limits, now, policy } = input;
  const { incident } = job;
  const stage = stageOf(job);

  if (incident === undefined || stage === undefined) {
    throw new AgentContextError('the job has no open incident');
  }

  const observations = incident.observations ?? {};
  const policyInput: PolicyInput = { job, limits, now, policy };
  const uiLandmarks =
    observations.uiLandmarks === undefined
      ? undefined
      : sanitizeLandmarks(observations.uiLandmarks, { workspaceName: input.workspaceName });

  const context = {
    allowedActions: allowedActions(policyInput),
    incident: {
      category: errorCatalog[incident.code].retry === 'none' ? 'unknown' : 'transient',
      code: incident.code,
      decisions: incident.decisions.map((decision) => decisionView(decision)),
      decisionsRemaining: decisionsRemaining(incident, limits),
      description: errorCatalog[incident.code].description,
      occurrences: incident.occurrences,
    },
    job: {
      ageHours: round1(Math.max(0, now.getTime() - Date.parse(job.createdAt)) / 3_600_000),
      emailCheckAttempt: job.emailCheckAttempt,
      exportAttempt: job.exportAttempt,
      exportClickAt: job.exportClickAt !== undefined,
      jobId: job.id,
      maxExportAttempts: policy.maxExportAttempts,
      maxLifetimeHours: policy.jobMaxLifetimeHours,
      period: job.period,
      stage,
      stageRetries: { ...job.stageRetries },
      status: job.status,
    },
    limits: {
      maxDecisionsPerIncident: limits.maxDecisionsPerIncident,
      maxStageRetries: policy.maxStageRetries,
    },
    observations: {
      ...(observations.emailSearch === undefined
        ? {}
        : {
            emailSearch: {
              candidates: observations.emailSearch.candidates,
              rejected: { ...observations.emailSearch.rejected },
              widenMinutes: observations.emailSearch.widenMinutes,
              ...(observations.emailSearch.code === undefined
                ? {}
                : { failedWith: observations.emailSearch.code }),
            },
          }),
      ...(observations.notionSession === undefined
        ? {}
        : { notionSession: observations.notionSession.state }),
      ...(uiLandmarks === undefined || uiLandmarks.length === 0 ? {} : { uiLandmarks }),
      ...(observations.inspectedAt === undefined || input.inspected === undefined
        ? {}
        : {
            health: healthView(input.inspected.health),
            recentEvents: input.inspected.events
              .slice(-INSPECTED_EVENT_COUNT)
              .map((event) => eventView(event)),
          }),
    },
  };

  const parsed = agentContextSchema.safeParse(context);

  if (!parsed.success) {
    throw new AgentContextError(
      parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
  }

  return parsed.data;
}

function decisionView(decision: IncidentDecision): AgentContext['incident']['decisions'][number] {
  const outcome =
    decision.modelFailure === undefined ? decision.outcome : `model_${decision.modelFailure}`;

  return {
    outcome:
      outcome !== undefined && outcomeSchema.safeParse(outcome).success ? outcome : 'unknown',
    ...(decision.action === undefined ? {} : { action: decision.action }),
  };
}

/** An event's structured fields only: its text is free text, and stays out. */
function eventView(
  event: JobEvent,
): NonNullable<AgentContext['observations']['recentEvents']>[number] {
  return {
    at: event.at,
    type: event.type,
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.status === undefined ? {} : { status: event.status }),
  };
}

function healthView(health: HealthSnapshot): NonNullable<AgentContext['observations']['health']> {
  const { cron, driveRoot, google, notionSession } = health;

  return {
    ...(cron?.ok === undefined ? {} : { lastCronOk: cron.ok }),
    ...(driveRoot === undefined
      ? {}
      : { drive: driveRoot.ok ? 'ok' : (driveRoot.code ?? 'UNKNOWN_ERROR') }),
    ...(google === undefined
      ? {}
      : { google: google.tokenOk ? 'ok' : (google.code ?? 'UNKNOWN_ERROR') }),
    ...(notionSession === undefined ? {} : { notionSession: notionSession.state }),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
