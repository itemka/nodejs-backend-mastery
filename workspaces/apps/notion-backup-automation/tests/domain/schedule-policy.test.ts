import { describe, expect, it } from 'vitest';

import {
  recordEmailNotFound,
  recordFailure,
  resumeAfterBackoff,
} from '../../src/domain/job-lifecycle.js';
import { nextEmailCheckDelaySec, nextWakeupDelaySec } from '../../src/domain/schedule-policy.js';
import type { JobStatus } from '../../src/domain/statuses.js';
import {
  attentionJob,
  jobInStatus,
  minutesAfter,
  policy,
  triggeringJob,
  waitingJob,
} from '../support/jobs.js';

describe('nextEmailCheckDelaySec', () => {
  it('waits 5 m, 15 m, then 30 m between checks', () => {
    expect([0, 1, 2, 3, 4, 10].map((attempt) => nextEmailCheckDelaySec(attempt))).toEqual([
      300, 900, 1800, 1800, 1800, 1800,
    ]);
  });

  it('produces 12:00 → 12:05 → 12:20 → 12:50 → 13:20 → 13:50 from an export at 12:00', () => {
    let job = waitingJob();
    let at = new Date(job.requestedAt ?? '');
    const times: string[] = [];

    for (let check = 0; check < 5; check += 1) {
      at = new Date(at.getTime() + (nextWakeupDelaySec(job) ?? 0) * 1000);
      times.push(at.toISOString().slice(11, 16));
      job = recordEmailNotFound(job, at, policy);
    }

    // waitingJob() requests the export at 04:02 UTC.
    expect(times).toEqual(['04:07', '04:22', '04:52', '05:22', '05:52']);
  });
});

describe('nextWakeupDelaySec', () => {
  it.each([
    'CREATED',
    'TRIGGERING_EXPORT',
    'EMAIL_FOUND',
    'DOWNLOADING',
    'VERIFYING',
    'UPLOADING',
  ] as JobStatus[])('wakes %s immediately', (status) => {
    expect(nextWakeupDelaySec(jobInStatus(status))).toBe(0);
  });

  it.each(['COMPLETE', 'FAILED', 'CANCELLED'] as JobStatus[])(
    'schedules nothing for %s',
    (status) => {
      expect(nextWakeupDelaySec(jobInStatus(status))).toBeUndefined();
    },
  );

  it('never polls a job that waits for a person', () => {
    expect(nextWakeupDelaySec(attentionJob('NOTION_SESSION_EXPIRED'))).toBeUndefined();
  });

  it('wakes the supervisor 1 min later while an incident awaits it', () => {
    expect(nextWakeupDelaySec(attentionJob('NOTION_UI_CHANGED'))).toBe(60);
  });

  it('backs off retries by the stage retry count, and respects Retry-After', () => {
    const first = recordFailure(triggeringJob(), minutesAfter(3), 'NOTION_UNAVAILABLE', policy);
    const second = recordFailure(
      resumeAfterBackoff(first, minutesAfter(9)),
      minutesAfter(9),
      'NOTION_UNAVAILABLE',
      policy,
    );

    expect(nextWakeupDelaySec(first)).toBe(300);
    expect(nextWakeupDelaySec(second)).toBe(900);
    expect(nextWakeupDelaySec(first, { retryAfterSec: 1200 })).toBe(1200);
  });
});
