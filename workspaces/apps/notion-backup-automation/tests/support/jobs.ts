import type { ErrorCode } from '../../src/domain/error-catalog.js';
import {
  beginExportTrigger,
  cancelJob,
  completeTransfer,
  failLifetimeExceeded,
  markExportClick,
  markTransferProgress,
  recordEmailFound,
  recordExportRequested,
  recordFailure,
} from '../../src/domain/job-lifecycle.js';
import type { BackupJob, BackupResult } from '../../src/domain/job.js';
import { backupJobSchema, newBackupJob } from '../../src/domain/job.js';
import { defaultBackupPolicy } from '../../src/domain/policy.js';
import type { JobStatus } from '../../src/domain/statuses.js';

/** 2026-10-01 06:00 in Warsaw: the daily cron's time on the first of the month. */
export const T0 = new Date('2026-10-01T04:00:00.000Z');

export const policy = defaultBackupPolicy;

export function minutesAfter(minutes: number, from: Date = T0): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

export function hoursAfter(hours: number, from: Date = T0): Date {
  return minutesAfter(hours * 60, from);
}

export const sampleResult: BackupResult = {
  driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
  entryCount: 198,
  fileName: 'notion-workspace-2026-10-01.zip',
  sha256: 'a'.repeat(64),
  sizeBytes: 8_907_221,
  yearFolderId: '1YearFolderId',
};

export const sampleEmail = {
  messageId: '19a2f0a1b2c3d4e5',
  receivedAt: minutesAfter(5).toISOString(),
};

/** Parses with the schema, so every builder and every rule result is a storable record. */
export function valid(job: BackupJob): BackupJob {
  return backupJobSchema.parse(job);
}

export const createdJob = (): BackupJob =>
  valid(newBackupJob({ kind: 'manual', now: T0, period: '2026-10' }));

export const triggeringJob = (): BackupJob =>
  valid(beginExportTrigger(createdJob(), minutesAfter(1)));

export const clickedJob = (): BackupJob => valid(markExportClick(triggeringJob(), minutesAfter(2)));

export const waitingJob = (): BackupJob =>
  valid(recordExportRequested(clickedJob(), minutesAfter(2), 'confirmed'));

export const emailFoundJob = (): BackupJob =>
  valid(recordEmailFound(waitingJob(), minutesAfter(7), sampleEmail));

export const downloadingJob = (): BackupJob =>
  valid(markTransferProgress(emailFoundJob(), minutesAfter(8), 'DOWNLOADING'));

export const verifyingJob = (): BackupJob =>
  valid(markTransferProgress(downloadingJob(), minutesAfter(8), 'VERIFYING'));

export const uploadingJob = (): BackupJob =>
  valid(markTransferProgress(verifyingJob(), minutesAfter(8), 'UPLOADING'));

export const completeJob = (): BackupJob =>
  valid(completeTransfer(uploadingJob(), minutesAfter(9), sampleResult));

export const retryableJob = (): BackupJob =>
  valid(recordFailure(triggeringJob(), minutesAfter(3), 'NOTION_UNAVAILABLE', policy));

export const attentionJob = (code: ErrorCode = 'NOTION_SESSION_EXPIRED'): BackupJob =>
  valid(recordFailure(triggeringJob(), minutesAfter(3), code, policy));

/** A valid job in every status, built through the lifecycle rules. */
export function jobInStatus(status: JobStatus): BackupJob {
  const builders: Record<JobStatus, () => BackupJob> = {
    CANCELLED: () => valid(cancelJob(waitingJob(), minutesAfter(10))),
    COMPLETE: completeJob,
    CREATED: createdJob,
    DOWNLOADING: downloadingJob,
    EMAIL_FOUND: emailFoundJob,
    FAILED: () => valid(failLifetimeExceeded(waitingJob(), hoursAfter(168))),
    NEEDS_ATTENTION: () => attentionJob(),
    RETRYABLE_FAILURE: retryableJob,
    TRIGGERING_EXPORT: triggeringJob,
    UPLOADING: uploadingJob,
    VERIFYING: verifyingJob,
    WAITING_FOR_EMAIL: waitingJob,
  };

  return builders[status]();
}
