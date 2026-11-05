import { z } from 'zod';

import { healthSnapshotSchema } from '../application/health-snapshot.js';
import type { HealthSnapshot } from '../application/health-snapshot.js';
import type { McpEnv } from '../config/env.js';
import { describeError, errorCodeSchema } from '../domain/error-catalog.js';
import { exportShrinkSchema } from '../domain/export-size.js';
import type { JobEvent } from '../domain/job-event.js';
import type { BackupJob } from '../domain/job.js';
import { stageOf } from '../domain/job.js';
import { jobKindSchema } from '../domain/naming.js';
import { jobStatusSchema, stageSchema } from '../domain/statuses.js';
import { isTerminal } from '../domain/statuses.js';
import { redactString } from '../shared/redact.js';

/*
 * The views the MCP tools and the Telegram status replies return. Each is built field by field
 * from an allowlist, so nothing else a job or health record holds can reach a client: no
 * schedule token, message ID, email ID or year folder, and no URL or token-shaped text.
 */

const timestamp = z.iso.datetime();
const MAX_EVENT_TEXT = 400;

export const eventViewSchema = z.object({
  at: timestamp,
  code: errorCodeSchema.optional(),
  status: jobStatusSchema.optional(),
  text: z.string().max(MAX_EVENT_TEXT),
  type: z.enum(['transition', 'notification', 'note', 'supervisor']),
});

export type EventView = z.infer<typeof eventViewSchema>;

export const resultViewSchema = z.object({
  driveFileId: z.string(),
  entryCount: z.number().int().optional(),
  fileName: z.string(),
  /** Set when no earlier completed backup existed to compare its size with. */
  firstBackup: z.literal(true).optional(),
  sha256: z.string(),
  /** Set when the backup is much smaller than the last completed one. */
  shrink: exportShrinkSchema.optional(),
  sizeBytes: z.number().int(),
});

/** Why the job waits or failed, in the catalog's static words. */
export const attentionViewSchema = z.object({
  code: errorCodeSchema,
  /**
   * `GOOGLE_AUTH_REQUIRED` only, once the Web client exists: the fixed phone re-login link,
   * `<APP_BASE_URL>/oauth/google/reauth`. Only the owner's Google account can finish it.
   */
  fixUrl: z.url().optional(),
  howToFix: z.string(),
  reason: z.string(),
  stage: stageSchema,
  supervisorSummary: z.string().optional(),
});

export type AttentionView = z.infer<typeof attentionViewSchema>;

export const jobViewSchema = z.object({
  attention: attentionViewSchema.optional(),
  /** Set by `backup_cancel` while a worker held the job: it ends at the next step boundary. */
  cancelRequestedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
  createdAt: timestamp,
  emailCheckAttempt: z.number().int(),
  exportAttempt: z.number().int(),
  jobId: z.string(),
  kind: jobKindSchema,
  /** When the next wakeup is due; absent once nothing is scheduled (ended, or waiting for you). */
  nextCheckAt: timestamp.optional(),
  period: z.string(),
  /** The newest events, oldest first. */
  recentEvents: z.array(eventViewSchema).max(10),
  /** When the export was requested. */
  requestedAt: timestamp.optional(),
  result: resultViewSchema.optional(),
  /** The stage the job is in, or resumes at; absent once it ended. */
  stage: stageSchema.optional(),
  status: jobStatusSchema,
});

export type JobView = z.infer<typeof jobViewSchema>;

export const jobSummarySchema = z.object({
  /** The code of the incident or failure, for a job that waits or failed. */
  attentionCode: errorCodeSchema.optional(),
  completedAt: timestamp.optional(),
  createdAt: timestamp,
  entryCount: z.number().int().optional(),
  fileName: z.string().optional(),
  jobId: z.string(),
  kind: jobKindSchema,
  period: z.string(),
  /** True when the backup is much smaller than the last completed one. */
  shrunk: z.boolean().optional(),
  sizeBytes: z.number().int().optional(),
  stage: stageSchema.optional(),
  status: jobStatusSchema,
});

export type JobSummary = z.infer<typeof jobSummarySchema>;

const notifierNameSchema = z.enum(['console', 'telegram']);

export const healthViewSchema = z.object({
  agent: z.object({
    /** False for `gemini` without `GEMINI_API_KEY`. */
    configured: z.boolean(),
    lastCheck: healthSnapshotSchema.shape.agentCheck,
    model: z.string(),
    provider: z.enum(['gemini', 'none']),
  }),
  autoStartEnabled: z.boolean(),
  driveRoot: healthSnapshotSchema.shape.driveRoot,
  google: healthSnapshotSchema.shape.google,
  heartbeat: z.object({ configured: z.boolean() }),
  lastCron: healthSnapshotSchema.shape.cron,
  notifications: z.object({
    /** The channels that deliver; Telegram only once both of its variables are set. */
    channels: z.array(notifierNameSchema),
    /** Variables a listed channel lacks. */
    missing: z.array(z.string()),
  }),
  /** The last automatic Notion login (Phase 14): when, why, and how it ended. */
  notionLogin: healthSnapshotSchema.shape.notionLogin,
  notionSession: healthSnapshotSchema.shape.notionSession,
  qstash: z.object({
    /**
     * When the last `smoke:qstash` ping reached the worker. Only that manual command sends one,
     * so an old value says nothing about QStash's health; the wakeups of each job do.
     */
    lastSmokeTestAt: timestamp.optional(),
  }),
});

export type HealthView = z.infer<typeof healthViewSchema>;

/** What a job view may add beside the job's own facts. */
export interface JobViewOptions {
  /** `googleReauthUrl(env)`: the `fixUrl` of `GOOGLE_AUTH_REQUIRED`. */
  readonly googleReauthUrl?: string | undefined;
}

/** The configuration `backup_health` reports beside the probe results. */
export interface HealthSettings {
  readonly agent: Pick<HealthView['agent'], 'configured' | 'model' | 'provider'>;
  readonly autoStartEnabled: boolean;
  readonly heartbeatConfigured: boolean;
  readonly notifications: HealthView['notifications'];
}

const urlPattern = /\bhttps?:\/\/[^\s"'<>`]+/gi;

/** Free text for a client: no URL at all, no token-shaped string, at most `max` characters. */
export function cleanText(text: string, max = MAX_EVENT_TEXT): string {
  const clean = redactString(text.replaceAll(urlPattern, '[link]'));

  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function eventView(event: JobEvent): EventView {
  return {
    at: event.at,
    text: cleanText(event.text),
    type: event.type,
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.status === undefined ? {} : { status: event.status }),
  };
}

/**
 * The incident a job waits on, or the error that left it retrying or failed. Reason and fix are
 * the catalog's text for the code, never what an integration said; the supervisor's summary is
 * cleaned before it is stored. An incident the supervisor is retrying stays on the job while it
 * works, but only a job that needs attention reports it.
 */
export function attentionView(
  job: BackupJob,
  options: JobViewOptions = {},
): AttentionView | undefined {
  const incident = job.status === 'NEEDS_ATTENTION' ? job.incident : undefined;
  const source =
    incident ??
    (job.status === 'RETRYABLE_FAILURE' || job.status === 'FAILED' ? job.lastError : undefined);

  if (source === undefined) {
    return undefined;
  }

  const { description, howToFix } = describeError(source.code);
  const summary = incident?.supervisorSummary;
  const fixUrl = source.code === 'GOOGLE_AUTH_REQUIRED' ? options.googleReauthUrl : undefined;

  return {
    code: source.code,
    howToFix,
    reason: description,
    stage: source.stage,
    ...(fixUrl === undefined ? {} : { fixUrl }),
    ...(summary === undefined ? {} : { supervisorSummary: cleanText(summary) }),
  };
}

/** `backup_status`: the job and its newest events, oldest first. */
export function jobView(
  job: BackupJob,
  events: readonly JobEvent[],
  options: JobViewOptions = {},
): JobView {
  const attention = attentionView(job, options);
  const stage = stageOf(job);
  const notBefore = isTerminal(job.status) ? undefined : job.schedule?.notBefore;

  return {
    createdAt: job.createdAt,
    emailCheckAttempt: job.emailCheckAttempt,
    exportAttempt: job.exportAttempt,
    jobId: job.id,
    kind: job.kind,
    period: job.period,
    recentEvents: events.slice(-10).map((event) => eventView(event)),
    status: job.status,
    ...(attention === undefined ? {} : { attention }),
    ...(job.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: job.cancelRequestedAt }),
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    ...(notBefore === undefined ? {} : { nextCheckAt: notBefore }),
    ...(job.requestedAt === undefined ? {} : { requestedAt: job.requestedAt }),
    ...(job.result === undefined ? {} : { result: resultView(job.result) }),
    ...(stage === undefined ? {} : { stage }),
  };
}

/** One `backup_list` entry. */
export function jobSummary(job: BackupJob): JobSummary {
  const attention = attentionView(job);
  const stage = stageOf(job);
  const { result } = job;

  return {
    createdAt: job.createdAt,
    jobId: job.id,
    kind: job.kind,
    period: job.period,
    status: job.status,
    ...(attention === undefined ? {} : { attentionCode: attention.code }),
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    ...(stage === undefined ? {} : { stage }),
    ...(result === undefined
      ? {}
      : {
          fileName: result.fileName,
          shrunk: result.shrink !== undefined,
          sizeBytes: result.sizeBytes,
          ...(result.entryCount === undefined ? {} : { entryCount: result.entryCount }),
        }),
  };
}

/** `backup_health`: the probes' last results and the configuration that decides what runs. */
export function healthView(snapshot: HealthSnapshot, settings: HealthSettings): HealthView {
  const { agentCheck, cron, driveRoot, google, notionLogin, notionSession, qstashPing } = snapshot;

  return {
    agent: { ...settings.agent, ...(agentCheck === undefined ? {} : { lastCheck: agentCheck }) },
    autoStartEnabled: settings.autoStartEnabled,
    heartbeat: { configured: settings.heartbeatConfigured },
    notifications: settings.notifications,
    qstash: qstashPing === undefined ? {} : { lastSmokeTestAt: qstashPing.receivedAt },
    ...(cron === undefined ? {} : { lastCron: cron }),
    ...(driveRoot === undefined ? {} : { driveRoot }),
    ...(google === undefined ? {} : { google }),
    ...(notionLogin === undefined ? {} : { notionLogin }),
    ...(notionSession === undefined ? {} : { notionSession }),
  };
}

/** What the `/mcp` function's configuration says about the agent, notifications and heartbeat. */
export function healthSettingsFrom(
  env: Pick<
    McpEnv,
    | 'AGENT_MODEL_NAME'
    | 'AGENT_MODEL_PROVIDER'
    | 'AUTO_START_ENABLED'
    | 'GEMINI_API_KEY'
    | 'HEARTBEAT_PING_URL'
    | 'NOTIFIERS'
    | 'TELEGRAM_HUB_TOKEN'
    | 'TELEGRAM_HUB_URL'
  >,
): HealthSettings {
  const telegramMissing = env.NOTIFIERS.includes('telegram')
    ? [
        ...(env.TELEGRAM_HUB_TOKEN ? [] : ['TELEGRAM_HUB_TOKEN']),
        ...(env.TELEGRAM_HUB_URL ? [] : ['TELEGRAM_HUB_URL']),
      ]
    : [];
  const channels = env.NOTIFIERS.filter(
    (name) => name === 'console' || telegramMissing.length === 0,
  );

  return {
    agent: {
      configured: env.AGENT_MODEL_PROVIDER === 'none' || env.GEMINI_API_KEY !== undefined,
      model: env.AGENT_MODEL_NAME,
      provider: env.AGENT_MODEL_PROVIDER,
    },
    autoStartEnabled: env.AUTO_START_ENABLED,
    heartbeatConfigured: env.HEARTBEAT_PING_URL,
    notifications: { channels, missing: telegramMissing },
  };
}

function resultView(result: NonNullable<BackupJob['result']>): z.infer<typeof resultViewSchema> {
  return {
    driveFileId: result.driveFileId,
    fileName: result.fileName,
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
    ...(result.entryCount === undefined ? {} : { entryCount: result.entryCount }),
    ...(result.shrink === undefined ? {} : { shrink: result.shrink }),
    ...(result.firstBackup === undefined ? {} : { firstBackup: result.firstBackup }),
  };
}
