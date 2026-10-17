import { z } from 'zod';

import { errorCodeSchema } from './error-catalog.js';
import type { JobKind } from './naming.js';
import { jobIdFor, jobIdSchema, jobKindSchema } from './naming.js';
import type { Period } from './period.js';
import { periodSchema } from './period.js';
import type { Stage } from './statuses.js';
import {
  isTerminal,
  isWorkingStatus,
  jobStatusSchema,
  stageOfWorkingStatus,
  stageSchema,
  workStatusSchema,
} from './statuses.js';

const timestamp = z.iso.datetime();

/** The supervisor's closed action set (see the plan's LLM Supervisor section). */
export const agentActionNames = [
  'inspect_status',
  'check_notion_session',
  'search_email_again',
  'wait',
  'retry_stage',
  'retry',
  'notify_user',
] as const;

/**
 * Why the job needs attention. `awaiting_supervisor` while the supervisor may still decide;
 * `awaiting_user` once a person has to act. It closes when the job moves past its stage.
 */
export const incidentSchema = z.object({
  code: errorCodeSchema,
  decisions: z
    .array(
      z.object({
        action: z.enum(agentActionNames),
        at: timestamp,
        outcome: z.string().max(40).optional(),
      }),
    )
    .max(20),
  occurrences: z.number().int().min(1),
  openedAt: timestamp,
  stage: stageSchema,
  state: z.enum(['awaiting_supervisor', 'awaiting_user']),
});

export type Incident = z.infer<typeof incidentSchema>;

export const lastErrorSchema = z.object({
  at: timestamp,
  code: errorCodeSchema,
  /** The catalog description, never runtime text. */
  message: z.string().max(400),
  stage: stageSchema,
});

export type LastError = z.infer<typeof lastErrorSchema>;

export const backupResultSchema = z.object({
  driveFileId: z.string().regex(/^[\w-]+$/),
  entryCount: z.number().int().min(0).optional(),
  fileName: z.string().max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().min(0),
  yearFolderId: z.string().regex(/^[\w-]+$/),
});

export type BackupResult = z.infer<typeof backupResultSchema>;

/** The job record, schema version 1. Absent keys mean "not known yet". */
export const backupJobSchema = z
  .object({
    cancelRequestedAt: timestamp.optional(),
    completedAt: timestamp.optional(),
    createdAt: timestamp,
    /** Drives the +5 / +15 / +30 m cadence; the number of email checks in this attempt. */
    emailCheckAttempt: z.number().int().min(0),
    emailMessageId: z
      .string()
      .regex(/^[\w-]{1,128}$/)
      .optional(),
    emailReceivedAt: timestamp.optional(),
    /** 1 for the first export request; each new attempt adds one. */
    exportAttempt: z.number().int().min(1),
    /** The write-ahead marker, saved just before the final Export click of this attempt. */
    exportClickAt: timestamp.optional(),
    id: jobIdSchema,
    incident: incidentSchema.optional(),
    kind: jobKindSchema,
    lastError: lastErrorSchema.optional(),
    period: periodSchema,
    /** The lower bound of the email search. */
    requestedAt: timestamp.optional(),
    result: backupResultSchema.optional(),
    resumeFrom: workStatusSchema.optional(),
    schedule: z
      .object({
        messageId: z.string().max(200).optional(),
        notBefore: timestamp,
        token: z.string().regex(/^[\w-]{16,64}$/),
      })
      .optional(),
    schemaVersion: z.literal(1),
    /** Consecutive retries per stage; cleared when a step of the stage succeeds. */
    stageRetries: z.partialRecord(stageSchema, z.number().int().min(0)),
    status: jobStatusSchema,
    /** Transfer runs of the current email that were rolled back. */
    transferAttempt: z.number().int().min(0),
    updatedAt: timestamp,
  })
  .superRefine((job, context) => {
    const require = (field: keyof typeof job, when: string) => {
      if (job[field] === undefined) {
        context.addIssue({ code: 'custom', message: `Required ${when}`, path: [field] });
      }
    };

    const idMatches =
      job.kind === 'forced' ? job.id.startsWith(`${job.period}-r`) : job.id === job.period;

    if (!idMatches) {
      context.addIssue({ code: 'custom', message: 'Does not match period and kind', path: ['id'] });
    }

    if (job.status === 'RETRYABLE_FAILURE' || job.status === 'NEEDS_ATTENTION') {
      require('resumeFrom', `in ${job.status}`);
      require('lastError', `in ${job.status}`);
    }

    if (job.status === 'NEEDS_ATTENTION') {
      require('incident', 'in NEEDS_ATTENTION');
    }

    if (
      ['WAITING_FOR_EMAIL', 'EMAIL_FOUND', 'DOWNLOADING', 'VERIFYING', 'UPLOADING'].includes(
        job.status,
      )
    ) {
      require('requestedAt', 'once the export is requested');
    }

    if (['EMAIL_FOUND', 'DOWNLOADING', 'VERIFYING', 'UPLOADING'].includes(job.status)) {
      require('emailMessageId', 'once the email is found');
    }

    if (job.status === 'COMPLETE') {
      require('result', 'in COMPLETE');
      require('completedAt', 'in COMPLETE');
    }
  });

export type BackupJob = z.infer<typeof backupJobSchema>;

export interface NewJobInput {
  kind: JobKind;
  now: Date;
  period: Period;
  /** Required for `forced`: 2 or more. */
  revision?: number;
}

export function newBackupJob({ kind, now, period, revision }: NewJobInput): BackupJob {
  const at = now.toISOString();

  return {
    createdAt: at,
    emailCheckAttempt: 0,
    exportAttempt: 1,
    id: jobIdFor(period, kind, revision),
    kind,
    period,
    schemaVersion: 1,
    stageRetries: {},
    status: 'CREATED',
    transferAttempt: 0,
    updatedAt: at,
  };
}

/** The stage a job is in or will resume; undefined once it is terminal. */
export function stageOf(job: Pick<BackupJob, 'resumeFrom' | 'status'>): Stage | undefined {
  if (isTerminal(job.status)) {
    return undefined;
  }

  if (isWorkingStatus(job.status)) {
    return stageOfWorkingStatus(job.status);
  }

  return job.resumeFrom === undefined ? undefined : stageOfWorkingStatus(job.resumeFrom);
}
