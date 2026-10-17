import { z } from 'zod';

import type { Period } from './period.js';
import { yearOfPeriod } from './period.js';

/**
 * A job ID: the period for the normal job (`2026-10`), or `<period>-r<N>` with N ≥ 2 for a
 * forced one (`2026-10-r2`). The reserved worker ID `_ping` never matches.
 */
export const jobIdSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-r([2-9]|[1-9]\d+))?$/);

export const jobKindSchema = z.enum(['scheduled', 'manual', 'forced']);

export type JobKind = z.infer<typeof jobKindSchema>;

/** The reserved worker path ID for the QStash smoke test (Step 20). It is never a job. */
export const PING_JOB_ID = '_ping';

/** The app-created folder inside the Drive root for `APP_ENV=dev` and the smoke tests. */
export const DEV_FOLDER_NAME = '_dev';

const forcedSuffix = /-r(\d+)$/;

export function jobIdFor(period: Period, kind: JobKind, revision?: number): string {
  if (kind !== 'forced') {
    return period;
  }

  if (revision === undefined || !Number.isInteger(revision) || revision < 2) {
    throw new RangeError('A forced job needs a revision of 2 or more');
  }

  return `${period}-r${revision}`;
}

/** The revision for the next forced job of `period`, from the IDs of the period's existing jobs. */
export function nextForcedRevision(period: Period, existingJobIds: readonly string[]): number {
  let highest = 1;

  for (const id of existingJobIds) {
    const revision = id.startsWith(`${period}-`) ? forcedSuffix.exec(id)?.[1] : undefined;

    if (revision !== undefined) {
      highest = Math.max(highest, Number(revision));
    }
  }

  return highest + 1;
}

/** `notion-workspace-YYYY-MM-DD.zip`, dated by the local date the export was requested. */
export function backupFileName(localDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new RangeError('Expected a YYYY-MM-DD date');
  }

  return `notion-workspace-${localDate}.zip`;
}

export function sha256SidecarName(fileName: string): string {
  return `${fileName}.sha256`;
}

/** The Drive year folder of a period's backup: `2026` for `2026-10`. */
export function yearFolderName(period: Period): string {
  return yearOfPeriod(period);
}
