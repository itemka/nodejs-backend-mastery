import { recordEmailFound, recordEmailNotFound } from '../../domain/job-lifecycle.js';
import type { StoredJob } from '../ports.js';
import type { StepContext, StepResult } from './step-runner.js';
import { callPort, commitRule, onStepError, saveFailure } from './step-runner.js';

/** Emails another job owns are skipped; after this many, the check counts as "no email yet". */
const MAX_EMAIL_CLAIMS = 3;

/** `check_email`: the newest trusted export email the job can claim; one owned by another job is skipped. */
export async function checkEmail(ctx: StepContext, current: StoredJob): Promise<StepResult> {
  const { job } = current;
  const requestedAfter = new Date(job.requestedAt ?? job.createdAt);
  const excludeIds: string[] = [];

  try {
    for (let claims = 0; claims < MAX_EMAIL_CLAIMS; claims += 1) {
      const search = await callPort(
        ctx,
        () => ctx.emails.findReadyEmail({ excludeIds, requestedAfter }),
        'GMAIL_UNAVAILABLE',
      );

      if (search.status === 'not_found') {
        break;
      }

      const { ownerJobId } = await ctx.jobs.markEmailConsumed(search.email.messageId, job.id);

      if (ownerJobId === job.id) {
        return {
          stored: await commitRule(ctx, current, (latest, now) =>
            recordEmailFound(latest, now, search.email),
          ),
        };
      }

      excludeIds.push(search.email.messageId);
      await ctx.store.note(
        job.id,
        `email.skipped · email ${search.email.messageId} belongs to job ${ownerJobId}`,
      );
    }

    return { stored: await commitRule(ctx, current, recordEmailNotFound) };
  } catch (error) {
    return onStepError(ctx, error, current, (failure) => saveFailure(ctx, current, failure));
  }
}
