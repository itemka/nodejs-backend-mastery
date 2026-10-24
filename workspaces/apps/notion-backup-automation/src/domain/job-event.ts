import { z } from 'zod';

import { errorCodeSchema } from './error-catalog.js';
import { jobStatusSchema } from './statuses.js';

/**
 * One entry of a job's event history (`events:<jobId>`, capped at 200). Hobby keeps runtime logs
 * for an hour, so this is how `backup_status` shows what happened. The text must already be
 * sanitized: no URLs with queries, email content, tokens or cookies.
 *
 * - `transition`: a status change;
 * - `notification`: what was sent to you;
 * - `note`: a step's finding without a status change, such as `export.shrunk`;
 * - `supervisor`: a supervisor decision.
 */
export const jobEventSchema = z.object({
  at: z.iso.datetime(),
  code: errorCodeSchema.optional(),
  status: jobStatusSchema.optional(),
  text: z.string().min(1).max(400),
  type: z.enum(['transition', 'notification', 'note', 'supervisor']),
});

export type JobEvent = z.infer<typeof jobEventSchema>;

export const MAX_JOB_EVENTS = 200;
