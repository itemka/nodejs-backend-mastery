import { compareWithPrevious } from '../../domain/export-size.js';
import { adoptExistingBackup } from '../../domain/job-lifecycle.js';
import type { BackupJob, BackupResult } from '../../domain/job.js';
import { describeSize } from '../notification-text.js';
import type { StoredJob } from '../ports.js';
import type { StepContext } from './step-runner.js';
import { callPort, commitRule } from './step-runner.js';

/** The jobs scanned for the export size check's baseline, newest first. */
const BASELINE_SCAN_LIMIT = 24;

/** A verified backup of the period already in Drive completes the job without an export. */
export async function adoptStoredBackup(
  ctx: StepContext,
  current: StoredJob,
): Promise<StoredJob | undefined> {
  const { job } = current;
  // A forced job must not adopt the period's normal backup: it was forced to make a new one.
  const existing = await callPort(
    ctx,
    () =>
      ctx.storage.findExisting(
        { period: job.period, ...(job.kind === 'forced' ? { jobId: job.id } : {}) },
        ctx.signal,
      ),
    'DRIVE_UNAVAILABLE',
  );

  if (existing === undefined) {
    return undefined;
  }

  const checked = await checkExportSize(ctx, job, {
    driveFileId: existing.driveFileId,
    fileName: existing.fileName,
    sha256: existing.sha256,
    sizeBytes: existing.sizeBytes,
    yearFolderId: existing.yearFolderId,
  });
  const stored = await commitRule(
    ctx,
    current,
    (latest, now) => adoptExistingBackup(latest, now, checked.result),
    'adopted from Drive',
  );

  await ctx.store.note(
    job.id,
    `backup.adopted · Drive already holds a verified backup of ${job.period}: ${existing.fileName}, from job ${existing.jobId}`,
  );
  await ctx.store.note(job.id, checked.note);

  return stored;
}

/**
 * The export size check, at the transition to COMPLETE: the newest earlier COMPLETE job is the
 * baseline. A shrunk backup still completes; its result records the shrink. Without a baseline,
 * the result records `firstBackup`, so its notice asks for a look (`2026-10-r2`, 2026-11-03).
 */
export async function checkExportSize(
  ctx: StepContext,
  job: BackupJob,
  result: BackupResult,
): Promise<{ note: string; result: BackupResult }> {
  let recent: StoredJob[];

  try {
    recent = await ctx.jobs.list({ limit: BASELINE_SCAN_LIMIT });
  } catch (error) {
    // The check never blocks a backup: an unreadable earlier job only skips it.
    ctx.logger.warn('export.size.failed', { error, jobId: job.id });

    return { note: 'export.size · earlier jobs could not be read; not compared', result };
  }

  const previous = recent
    .map((stored) => stored.job)
    .find((other) => other.id !== job.id && other.status === 'COMPLETE');

  if (previous?.result === undefined) {
    return {
      note: 'export.size · no earlier backup to compare with',
      result: { ...result, firstBackup: true },
    };
  }

  const shrink = compareWithPrevious(
    result,
    {
      jobId: previous.id,
      sizeBytes: previous.result.sizeBytes,
      ...(previous.result.entryCount === undefined
        ? {}
        : { entryCount: previous.result.entryCount }),
    },
    ctx.exportShrinkRatio,
  );
  const comparison = `${describeSize(result)}; last backup (${previous.id}) had ${describeSize(previous.result)}`;

  return shrink === undefined
    ? { note: `export.size · ${comparison}`, result }
    : { note: `export.shrunk · ${comparison}`, result: { ...result, shrink } };
}
