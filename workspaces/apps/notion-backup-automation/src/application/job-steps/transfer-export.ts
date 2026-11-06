import { InvalidJobStateError } from '../../domain/domain-errors.js';
import type { ErrorCode } from '../../domain/error-catalog.js';
import type { TransferRollbackReason } from '../../domain/job-lifecycle.js';
import {
  completeTransfer,
  markTransferProgress,
  recordLinkExpired,
  rollbackTransfer,
} from '../../domain/job-lifecycle.js';
import { backupFileName } from '../../domain/naming.js';
import { localDateFor } from '../../domain/period.js';
import { isTransferMarker } from '../../domain/statuses.js';
import type { StoredJob } from '../ports.js';
import { adoptStoredBackup, checkExportSize } from './backup-completion.js';
import type { StepContext, StepFailure, StepResult } from './step-runner.js';
import {
  callPort,
  CancelRequested,
  commitRule,
  guarded,
  onStepError,
  saveFailure,
} from './step-runner.js';

/** The failures that roll a started transfer back instead of recording a failure. */
const transferRollbacks: Readonly<Partial<Record<ErrorCode, TransferRollbackReason>>> = {
  DRIVE_CHECKSUM_MISMATCH: 'checksum_mismatch',
  TRANSFER_TIMEOUT: 'over_budget',
  ZIP_INVALID: 'zip_invalid',
};

/**
 * `transfer`: Drive first, then the transfer in one invocation; each progress marker is saved
 * before its work starts. A stopped run rolls back to EMAIL_FOUND (or a new attempt) per the
 * domain rules.
 */
export async function transferExport(ctx: StepContext, current: StoredJob): Promise<StepResult> {
  let latest = current;

  try {
    const adopted = await adoptStoredBackup(ctx, latest);

    if (adopted !== undefined) {
      return { stored: adopted };
    }

    const { emailMessageId, id, period, requestedAt } = latest.job;

    if (emailMessageId === undefined || requestedAt === undefined) {
      throw new InvalidJobStateError('UNEXPECTED_STATUS', latest.job.status);
    }

    const result = await callPort(
      ctx,
      () =>
        ctx.transfer.run({
          emailMessageId,
          fileName: backupFileName(localDateFor(new Date(requestedAt), ctx.timeZone)),
          jobId: id,
          onStep: (marker) =>
            guarded(async () => {
              latest = await ctx.store.commit(latest, (job) => {
                if (job.cancelRequestedAt !== undefined) {
                  throw new CancelRequested();
                }

                return markTransferProgress(job, ctx.clock.now(), marker);
              });
            }),
          period,
          signal: ctx.signal,
        }),
      'TRANSFER_TIMEOUT',
    );

    if (result.outcome === 'link_expired') {
      return { stored: await commitRule(ctx, latest, recordLinkExpired, 'link expired') };
    }

    const { backup, entryCount } = result;
    const checked = await checkExportSize(ctx, latest.job, {
      driveFileId: backup.driveFileId,
      entryCount,
      fileName: backup.fileName,
      sha256: backup.sha256,
      sizeBytes: backup.sizeBytes,
      yearFolderId: backup.yearFolderId,
    });
    const stored = await commitRule(
      ctx,
      latest,
      (job, now) => completeTransfer(job, now, checked.result),
      backup.uploaded ? 'uploaded' : 'already in Drive',
    );

    await ctx.store.note(id, checked.note);

    if (backup.sidecar === 'failed') {
      await ctx.store.note(id, 'drive.sidecar_failed · the .sha256 sidecar was not written');
    }

    return { stored };
  } catch (error) {
    return onStepError(ctx, error, latest, (failure) => transferFailure(ctx, latest, failure));
  }
}

/** An invalid ZIP, a checksum mismatch or the time budget roll the transfer back; anything else is a failure. */
async function transferFailure(
  ctx: StepContext,
  latest: StoredJob,
  failure: StepFailure,
): Promise<StepResult> {
  const reason = transferRollbacks[failure.code];

  if (reason === undefined || !isTransferMarker(latest.job.status)) {
    return saveFailure(ctx, latest, failure);
  }

  return {
    stored: await commitRule(
      ctx,
      latest,
      (job, now, policy) => rollbackTransfer(job, now, reason, policy),
      reason.replaceAll('_', ' '),
    ),
  };
}
