import { z } from 'zod';

import { jobIdSchema } from './naming.js';

/**
 * The last completed backup, recorded on a backup that is much smaller than it. Every integrity
 * check passes for a ZIP of the wrong scope, so only this comparison catches a shrinking export.
 */
export const exportShrinkSchema = z.object({
  previousEntryCount: z.number().int().min(0).optional(),
  previousJobId: jobIdSchema,
  previousSizeBytes: z.number().int().min(0),
});

export type ExportShrink = z.infer<typeof exportShrinkSchema>;

export interface ExportSize {
  /** The number of files in the ZIP; unknown for a backup adopted from Drive. */
  readonly entryCount?: number | undefined;
  readonly sizeBytes: number;
}

/** `EXPORT_SHRINK_RATIO`: a backup below half the last one's file count or size is flagged. */
export const DEFAULT_EXPORT_SHRINK_RATIO = 0.5;

/**
 * Whether `current` shrank against `previous`: fewer files than `ratio` × the previous count, or
 * fewer bytes than `ratio` × the previous size. Exactly `ratio` is not flagged. When either side
 * has no file count, only the sizes are compared.
 */
export function compareWithPrevious(
  current: ExportSize,
  previous: ExportSize & { readonly jobId: string },
  ratio: number = DEFAULT_EXPORT_SHRINK_RATIO,
): ExportShrink | undefined {
  if (!(ratio > 0 && ratio < 1)) {
    throw new RangeError('The shrink ratio must be between 0 and 1');
  }

  const fewerFiles =
    current.entryCount !== undefined &&
    previous.entryCount !== undefined &&
    current.entryCount < previous.entryCount * ratio;
  const smaller = current.sizeBytes < previous.sizeBytes * ratio;

  if (!fewerFiles && !smaller) {
    return undefined;
  }

  return {
    previousJobId: previous.jobId,
    previousSizeBytes: previous.sizeBytes,
    ...(previous.entryCount === undefined ? {} : { previousEntryCount: previous.entryCount }),
  };
}
