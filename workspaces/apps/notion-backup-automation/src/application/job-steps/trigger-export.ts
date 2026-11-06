import { markExportClick, recordExportRequested } from '../../domain/job-lifecycle.js';
import type { StoredJob } from '../ports.js';
import { adoptStoredBackup } from './backup-completion.js';
import type { StepContext, StepResult } from './step-runner.js';
import {
  callPort,
  CancelRequested,
  commitRule,
  guarded,
  onStepError,
  saveFailure,
} from './step-runner.js';

/**
 * `trigger_export`: Drive first, so an existing backup of the period is adopted (the Redis-loss
 * guard). Then the export, with the write-ahead click marker saved just before the final click.
 */
export async function triggerExport(ctx: StepContext, current: StoredJob): Promise<StepResult> {
  let latest = current;

  try {
    const adopted = await adoptStoredBackup(ctx, latest);

    if (adopted !== undefined) {
      return { stored: adopted };
    }

    const { outcome } = await callPort(
      ctx,
      () =>
        ctx.trigger.requestExport({
          onBeforeFinalClick: () =>
            guarded(async () => {
              latest = await ctx.store.commit(latest, (job) => {
                if (job.cancelRequestedAt !== undefined) {
                  throw new CancelRequested();
                }

                return markExportClick(job, ctx.clock.now());
              });
              await ctx.store.note(latest.job.id, 'export.click · marker saved, clicking Export');
            }),
          signal: ctx.signal,
        }),
      'NOTION_UNAVAILABLE',
    );

    return {
      stored: await commitRule(
        ctx,
        latest,
        (job, now) => recordExportRequested(job, now, outcome),
        outcome.replaceAll('_', ' '),
      ),
    };
  } catch (error) {
    return onStepError(ctx, error, latest, (failure) => saveFailure(ctx, latest, failure));
  }
}
