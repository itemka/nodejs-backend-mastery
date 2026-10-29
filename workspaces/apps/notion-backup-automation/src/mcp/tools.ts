import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { SchedulerError } from '../adapters/qstash/qstash-scheduler.js';
import type { AgentCheckResult } from '../agent/agent-check.js';
import { ApplicationError } from '../application/application-error.js';
import type { BackupApplicationService } from '../application/backup-service.js';
import type { HealthStore, RateLimiter } from '../application/ports.js';
import { stageOf } from '../domain/job.js';
import { jobIdSchema } from '../domain/naming.js';
import { jobStatusSchema, stageSchema } from '../domain/statuses.js';
import { rateLimits } from '../http/rate-limit.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { HealthSettings } from './views.js';
import {
  cleanText,
  healthView,
  healthViewSchema,
  jobSummary,
  jobSummarySchema,
  jobView,
  jobViewSchema,
} from './views.js';

/** The codes a tool reports with `isError: true`, beside the application's own. */
export type ToolErrorCode =
  | ApplicationError['code']
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED'
  | 'SCHEDULER_UNAVAILABLE';

export interface BackupToolDeps {
  /** One canned supervisor decision on the configured model (`checkAgent`). */
  readonly agentCheck: () => Promise<AgentCheckResult>;
  readonly clock: Clock;
  readonly health: Pick<HealthStore, 'read' | 'write'>;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  readonly service: Pick<
    BackupApplicationService,
    'cancel' | 'list' | 'process' | 'retry' | 'start' | 'status'
  >;
  readonly settings: HealthSettings;
}

/** A refusal the tool itself decides, such as a rate limit. */
class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

const jobIdInput = jobIdSchema.describe('A job ID: the period, such as 2026-10, or 2026-10-r2');
const reasonInput = z.string().max(200);

/** The `structuredContent` of a failed call. */
export interface ToolErrorOutput {
  readonly code: ToolErrorCode;
  readonly message: string;
}

/**
 * The 7 tools, each a thin call into `BackupApplicationService` or the health store. Nothing
 * runs a backup step inline: the worker does, woken by the wakeup a tool publishes.
 */
export function registerBackupTools(server: McpServer, deps: BackupToolDeps): void {
  const { agentCheck, clock, health, limiter, service, settings } = deps;

  server.registerTool(
    'backup_start',
    {
      // Not idempotent as a tool: the same `force: true` call after a job ends starts another.
      annotations: { idempotentHint: false, openWorldHint: true },
      description:
        'Starts this month’s Notion workspace backup and returns at once with the job in CREATED; the worker requests the export about a minute later and the job runs for hours (the export email, then the transfer to Drive). Idempotent per month: an existing job is returned with created: false. force starts a new job for the month once no job is active.',
      inputSchema: z.object({
        force: z
          .boolean()
          .default(false)
          .describe(
            'A new job (<period>-r<N>) although the month has one; refused while any job is active',
          ),
        reason: reasonInput
          .optional()
          .describe('Why you start it; kept, redacted, in the job’s first event'),
      }),
      outputSchema: z.object({
        created: z.boolean(),
        jobId: z.string(),
        message: z.string(),
        nextCheckAt: z.iso.datetime().optional(),
        nextCheckInMinutes: z.number().int().optional(),
        period: z.string(),
        status: jobStatusSchema,
      }),
      title: 'Start the monthly backup',
    },
    ({ force, reason }) =>
      run('backup_start', deps, async () => {
        const { created, job } = await service.start({
          force,
          ...(reason === undefined ? {} : { reason }),
        });
        const notBefore = job.schedule?.notBefore;
        const message = created
          ? `Job ${job.id} created; the worker requests the Notion export in about a minute. Follow it with backup_status.`
          : `Job ${job.id} already exists for ${job.period} (${job.status}); nothing new was started.`;

        return {
          output: {
            created,
            jobId: job.id,
            message,
            period: job.period,
            status: job.status,
            ...(notBefore === undefined
              ? {}
              : {
                  nextCheckAt: notBefore,
                  nextCheckInMinutes: Math.max(
                    0,
                    Math.ceil((Date.parse(notBefore) - clock.now().getTime()) / 60_000),
                  ),
                }),
          },
          summary: message,
        };
      }),
  );

  server.registerTool(
    'backup_status',
    {
      annotations: { readOnlyHint: true },
      description:
        'One job’s status, stage, attempts, next check, result (file, size, SHA-256, Drive file ID) or what needs attention with how to fix it, and its last 10 events. Without jobId: the active job, else the latest.',
      inputSchema: z.object({ jobId: jobIdInput.optional() }),
      outputSchema: jobViewSchema,
      title: 'Backup job status',
    },
    ({ jobId }) =>
      run('backup_status', deps, async () => {
        const { events, job } = await service.status(jobId);
        const view = jobView(job, events);

        return {
          output: view,
          summary: `Job ${view.jobId}: ${view.status}${view.stage === undefined ? '' : ` (stage ${view.stage})`}${view.attention === undefined ? '' : ` · ${view.attention.code}`}`,
        };
      }),
  );

  server.registerTool(
    'backup_list',
    {
      annotations: { readOnlyHint: true },
      description: 'The newest backup jobs first, with status, file name and size.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(24).default(12) }),
      outputSchema: z.object({ jobs: z.array(jobSummarySchema) }),
      title: 'List backup jobs',
    },
    ({ limit }) =>
      run('backup_list', deps, async () => {
        const stored = await service.list(limit);
        const jobs = stored.map((job) => jobSummary(job));

        return {
          output: { jobs },
          summary: `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}, newest first`,
        };
      }),
  );

  server.registerTool(
    'backup_process',
    {
      annotations: { idempotentHint: true },
      description:
        'Wakes a job now instead of at its next scheduled check (a new token and an immediate wakeup; nothing runs inline). queued is false when the job ended or a worker holds it. At most 10 calls per job per hour.',
      inputSchema: z.object({ jobId: jobIdInput }),
      outputSchema: z.object({
        jobId: z.string(),
        queued: z.boolean(),
        reason: z.enum(['leased', 'queued', 'terminal']),
        status: jobStatusSchema,
      }),
      title: 'Wake a backup job',
    },
    ({ jobId }) =>
      run('backup_process', deps, async () => {
        const limit = await limiter.take(`mcp:process:${jobId}`, rateLimits.mcpProcess);

        if (!limit.allowed) {
          throw new ToolError(
            'RATE_LIMITED',
            `backup_process allows ${rateLimits.mcpProcess.limit} calls per job per hour; try again in ${Math.ceil(limit.retryAfterSec / 60)} min`,
          );
        }

        const { job, queued, reason } = await service.process(jobId);

        return {
          output: { jobId: job.id, queued, reason, status: job.status },
          summary: queued
            ? `Job ${job.id} woken (${job.status})`
            : `Job ${job.id} not woken: ${reason === 'terminal' ? `it is ${job.status}` : 'a worker holds it; it runs anyway'}`,
        };
      }),
  );

  server.registerTool(
    'backup_retry',
    {
      annotations: { destructiveHint: false },
      description:
        'Retries a job that needs attention or waits to retry: closes the incident, resets the stage’s retries and queues a wakeup. fromStage NOTION_TRIGGER after the export was clicked opens a new export attempt; the default resumes the failed stage.',
      inputSchema: z.object({
        fromStage: stageSchema
          .optional()
          .describe('NOTION_TRIGGER, EMAIL_WAIT or TRANSFER; default: the failed stage'),
        jobId: jobIdInput,
      }),
      outputSchema: z.object({
        jobId: z.string(),
        queued: z.boolean(),
        resumeFrom: stageSchema,
        status: jobStatusSchema,
      }),
      title: 'Retry a backup job',
    },
    ({ fromStage, jobId }) =>
      run('backup_retry', deps, async () => {
        const { job } = await service.retry(jobId, fromStage);
        const resumeFrom = stageOf(job) ?? fromStage ?? 'NOTION_TRIGGER';

        return {
          output: { jobId: job.id, queued: true, resumeFrom, status: job.status },
          summary: `Job ${job.id} retried from ${resumeFrom} (${job.status})`,
        };
      }),
  );

  server.registerTool(
    'backup_cancel',
    {
      annotations: { destructiveHint: true },
      description:
        'Cancels a job that has not ended: at once, or at the next step boundary while a worker holds it. A cancelled month needs backup_start with force for a new backup.',
      inputSchema: z.object({
        jobId: jobIdInput,
        reason: reasonInput.min(1).describe('Why; kept, redacted, in the job’s events'),
      }),
      outputSchema: z.object({ jobId: z.string(), status: jobStatusSchema }),
      title: 'Cancel a backup job',
    },
    ({ jobId, reason }) =>
      run('backup_cancel', deps, async () => {
        const { job } = await service.cancel(jobId, reason);

        return {
          output: { jobId: job.id, status: job.status },
          summary:
            job.status === 'CANCELLED'
              ? `Job ${job.id} cancelled`
              : `Job ${job.id} is cancelled at its next step boundary (a worker holds it)`,
        };
      }),
  );

  server.registerTool(
    'backup_health',
    {
      annotations: { readOnlyHint: true },
      description:
        'The last results of the daily probes (Notion session and export dialog, Google token and scopes, Drive folder), the last QStash ping and cron run, and the agent, notification, heartbeat and auto-start settings. Reads stored results; it starts no browser. checkAgent: true also runs one canned, content-free supervisor decision on the configured model (at most 20 s, 5 per hour) and reports it as agent.lastCheck.',
      inputSchema: z.object({
        checkAgent: z
          .boolean()
          .default(false)
          .describe('Run the supervisor smoke test: one canned decision, nothing executed'),
      }),
      outputSchema: healthViewSchema,
      title: 'Backup health',
    },
    ({ checkAgent }) =>
      run('backup_health', deps, async () => {
        if (checkAgent) {
          const limit = await limiter.take('mcp:check-agent', rateLimits.mcpCheckAgent);

          if (!limit.allowed) {
            throw new ToolError(
              'RATE_LIMITED',
              `checkAgent allows ${rateLimits.mcpCheckAgent.limit} checks per hour; try again in ${Math.ceil(limit.retryAfterSec / 60)} min`,
            );
          }

          await health.write('agentCheck', await agentCheck());
        }

        const view = healthView(await health.read(), settings);

        return {
          output: view,
          summary: `Notion ${view.notionSession?.state ?? 'not checked'} · Google ${googleState(view)} · Drive ${driveState(view)} · last cron ${view.lastCron?.ranAt ?? 'never'}${checkAgent ? ` · agent ${agentState(view)}` : ''}`,
        };
      }),
  );
}

/**
 * The tool's result: a one-line summary and the JSON, for clients that read only the text, and
 * the same object as `structuredContent`. A failure is a result with `isError` and
 * `{ code, message }`; anything unexpected is logged and reported without its details.
 */
async function run(
  tool: string,
  { logger }: Pick<BackupToolDeps, 'logger'>,
  action: () => Promise<{ output: Record<string, unknown>; summary: string }>,
): Promise<CallToolResult> {
  try {
    const { output, summary } = await action();

    logger.info('mcp.tool', { tool });

    return {
      content: [{ text: `${summary}\n${JSON.stringify(output)}`, type: 'text' }],
      structuredContent: output,
    };
  } catch (error) {
    const failure = toolFailure(error);

    if (failure.code === 'INTERNAL_ERROR') {
      logger.error('mcp.tool_failed', { error, tool });
    } else {
      logger.info('mcp.tool_refused', { code: failure.code, tool });
    }

    return {
      content: [{ text: `${failure.code}: ${failure.message}`, type: 'text' }],
      isError: true,
      structuredContent: failure,
    };
  }
}

function toolFailure(error: unknown): ToolErrorOutput {
  if (error instanceof ApplicationError || error instanceof ToolError) {
    return { code: error.code, message: cleanText(error.message, 200) };
  }

  if (error instanceof SchedulerError) {
    return { code: error.code, message: 'QStash did not accept the wakeup; try again shortly' };
  }

  return { code: 'INTERNAL_ERROR', message: 'The tool failed; the function logs have the error' };
}

function googleState({ google }: z.infer<typeof healthViewSchema>): string {
  if (google === undefined) return 'not checked';

  return google.tokenOk ? 'ok' : (google.code ?? 'failed');
}

function agentState({ agent }: z.infer<typeof healthViewSchema>): string {
  const check = agent.lastCheck;

  if (check === undefined) return 'not checked';

  return `${check.ok ? 'ok' : (check.failure ?? 'failed')} (${check.model})`;
}

function driveState({ driveRoot }: z.infer<typeof healthViewSchema>): string {
  if (driveRoot === undefined) return 'not checked';

  return driveRoot.ok ? 'ok' : (driveRoot.code ?? 'failed');
}
