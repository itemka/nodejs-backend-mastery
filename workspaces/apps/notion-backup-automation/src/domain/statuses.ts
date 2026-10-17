import { z } from 'zod';

export const jobStatuses = [
  'CREATED',
  'TRIGGERING_EXPORT',
  'WAITING_FOR_EMAIL',
  'EMAIL_FOUND',
  'DOWNLOADING',
  'VERIFYING',
  'UPLOADING',
  'COMPLETE',
  'RETRYABLE_FAILURE',
  'NEEDS_ATTENTION',
  'FAILED',
  'CANCELLED',
] as const;

export const jobStatusSchema = z.enum(jobStatuses);

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const stages = ['NOTION_TRIGGER', 'EMAIL_WAIT', 'TRANSFER'] as const;

export const stageSchema = z.enum(stages);

export type Stage = z.infer<typeof stageSchema>;

/** The status each stage starts from. `resumeFrom`, `backup_retry` and the supervisor return here. */
export const workStatusSchema = z.enum(['TRIGGERING_EXPORT', 'WAITING_FOR_EMAIL', 'EMAIL_FOUND']);

export type WorkStatus = z.infer<typeof workStatusSchema>;

export type TerminalStatus = Extract<JobStatus, 'CANCELLED' | 'COMPLETE' | 'FAILED'>;

/** Progress markers inside one transfer invocation. Never a tick entry point. */
export type TransferMarker = Extract<JobStatus, 'DOWNLOADING' | 'UPLOADING' | 'VERIFYING'>;

/** A status in which the job is doing or about to do the work of a stage. */
export type WorkingStatus = Exclude<
  JobStatus,
  'NEEDS_ATTENTION' | 'RETRYABLE_FAILURE' | TerminalStatus
>;

export const stageEntryStatus: Readonly<Record<Stage, WorkStatus>> = {
  EMAIL_WAIT: 'WAITING_FOR_EMAIL',
  NOTION_TRIGGER: 'TRIGGERING_EXPORT',
  TRANSFER: 'EMAIL_FOUND',
};

const workingStatusStage: Readonly<Record<WorkingStatus, Stage>> = {
  CREATED: 'NOTION_TRIGGER',
  DOWNLOADING: 'TRANSFER',
  EMAIL_FOUND: 'TRANSFER',
  TRIGGERING_EXPORT: 'NOTION_TRIGGER',
  UPLOADING: 'TRANSFER',
  VERIFYING: 'TRANSFER',
  WAITING_FOR_EMAIL: 'EMAIL_WAIT',
};

export function isTerminal(status: JobStatus): status is TerminalStatus {
  return status === 'COMPLETE' || status === 'FAILED' || status === 'CANCELLED';
}

export function isTransferMarker(status: JobStatus): status is TransferMarker {
  return status === 'DOWNLOADING' || status === 'VERIFYING' || status === 'UPLOADING';
}

export function isWorkingStatus(status: JobStatus): status is WorkingStatus {
  return Object.hasOwn(workingStatusStage, status);
}

export function stageOfWorkingStatus(status: WorkingStatus): Stage {
  return workingStatusStage[status];
}
