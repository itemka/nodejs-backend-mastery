import type { JobEvent } from '../../domain/job-event.js';
import { jobEventSchema } from '../../domain/job-event.js';
import type { BackupJob } from '../../domain/job.js';
import { backupJobSchema } from '../../domain/job.js';

/** `STATE_SCHEMA_INVALID`: a stored or outgoing record failed its schema. Nothing is written. */
export class StateSchemaInvalidError extends Error {
  readonly code = 'STATE_SCHEMA_INVALID';
  readonly record: 'event' | 'job';

  constructor(record: 'event' | 'job', subject: string) {
    super(`The ${record} record for ${subject} failed schema validation`);
    this.name = 'StateSchemaInvalidError';
    this.record = record;
  }
}

/** Validates a job before it is written. A record that would fail on read is never stored. */
export function encodeJob(job: BackupJob): string {
  const parsed = backupJobSchema.safeParse(job);

  if (!parsed.success) {
    throw new StateSchemaInvalidError('job', job.id);
  }

  return JSON.stringify(parsed.data);
}

export function decodeJob(data: string, jobId: string): BackupJob {
  let value: unknown;

  try {
    value = JSON.parse(data);
  } catch {
    throw new StateSchemaInvalidError('job', jobId);
  }

  const parsed = backupJobSchema.safeParse(value);

  if (!parsed.success || parsed.data.id !== jobId) {
    throw new StateSchemaInvalidError('job', jobId);
  }

  return parsed.data;
}

export function encodeEvent(event: JobEvent, jobId: string): string {
  const parsed = jobEventSchema.safeParse(event);

  if (!parsed.success) {
    throw new StateSchemaInvalidError('event', jobId);
  }

  return JSON.stringify(parsed.data);
}

/** Events are history: an unreadable entry is skipped instead of failing the whole read. */
export function decodeEvents(entries: readonly string[]): JobEvent[] {
  return entries.flatMap((entry) => {
    try {
      const parsed = jobEventSchema.safeParse(JSON.parse(entry));

      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export function assertCreatable(job: BackupJob): void {
  if (job.status !== 'CREATED') {
    throw new RangeError('Only a CREATED job can be created');
  }
}

export function assertSameJob(jobId: string, next: BackupJob): void {
  if (next.id !== jobId) {
    throw new RangeError('The job ID does not match the record');
  }
}
