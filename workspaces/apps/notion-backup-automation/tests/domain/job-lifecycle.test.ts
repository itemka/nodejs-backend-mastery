import { describe, expect, it } from 'vitest';

import { InvalidJobStateError } from '../../src/domain/domain-errors.js';
import type { ErrorCode } from '../../src/domain/error-catalog.js';
import {
  adoptExistingBackup,
  beginExportTrigger,
  cancelJob,
  completeTransfer,
  failLifetimeExceeded,
  handOverToUser,
  isLifetimeExceeded,
  markExportClick,
  markTransferProgress,
  recordEmailFound,
  recordEmailNotFound,
  recordExportRequested,
  recordFailure,
  recordLinkExpired,
  requestCancel,
  resumeAfterBackoff,
  retryIncident,
  retryJob,
  rollbackTransfer,
  startNewExportAttempt,
} from '../../src/domain/job-lifecycle.js';
import type { BackupJob, Incident } from '../../src/domain/job.js';
import type { JobStatus } from '../../src/domain/statuses.js';
import { jobStatuses } from '../../src/domain/statuses.js';
import {
  attentionJob,
  clickedJob,
  createdJob,
  downloadingJob,
  emailFoundJob,
  hoursAfter,
  jobInStatus,
  minutesAfter,
  policy,
  retryableJob,
  sampleEmail,
  sampleResult,
  T0,
  triggeringJob,
  uploadingJob,
  valid,
  verifyingJob,
  waitingJob,
} from '../support/jobs.js';

function invalidState(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidJobStateError) {
      return error.reason;
    }

    throw error;
  }

  throw new Error('Expected an InvalidJobStateError');
}

/** A job that has used every export attempt, still in `status`'s position of the flow. */
function lastAttempt(job: BackupJob): BackupJob {
  return { ...job, exportAttempt: policy.maxExportAttempts };
}

/** Fails the trigger `times` times, resuming after each backoff. */
function failRepeatedly(code: ErrorCode, times: number): BackupJob {
  let job = triggeringJob();

  for (let failure = 0; failure < times; failure += 1) {
    job = recordFailure(job, minutesAfter(10 + failure), code, policy);

    if (job.status === 'RETRYABLE_FAILURE') {
      job = resumeAfterBackoff(job, minutesAfter(10 + failure));
    }
  }

  return job;
}

const nonTerminal = jobStatuses.filter(
  (status) => !['COMPLETE', 'FAILED', 'CANCELLED'].includes(status),
);

type Rule = (job: BackupJob) => BackupJob;

describe('the edges drawn in the plan’s state diagram, plus the undrawn ones', () => {
  const at = minutesAfter(30);
  const edges: [string, () => BackupJob, Rule, JobStatus, JobStatus][] = [
    [
      'start the trigger',
      createdJob,
      (job) => beginExportTrigger(job, at),
      'CREATED',
      'TRIGGERING_EXPORT',
    ],
    [
      'confirmed',
      clickedJob,
      (job) => recordExportRequested(job, at, 'confirmed'),
      'TRIGGERING_EXPORT',
      'WAITING_FOR_EMAIL',
    ],
    [
      'already running',
      triggeringJob,
      (job) => recordExportRequested(job, at, 'already_in_progress'),
      'TRIGGERING_EXPORT',
      'WAITING_FOR_EMAIL',
    ],
    [
      'in doubt',
      clickedJob,
      (job) => recordExportRequested(job, at, 'in_doubt'),
      'TRIGGERING_EXPORT',
      'WAITING_FOR_EMAIL',
    ],
    [
      'no email yet',
      waitingJob,
      (job) => recordEmailNotFound(job, at, policy),
      'WAITING_FOR_EMAIL',
      'WAITING_FOR_EMAIL',
    ],
    [
      'trusted email',
      waitingJob,
      (job) => recordEmailFound(job, at, sampleEmail),
      'WAITING_FOR_EMAIL',
      'EMAIL_FOUND',
    ],
    [
      '48 h timeout, attempt < 3',
      waitingJob,
      (job) => recordEmailNotFound(job, hoursAfter(49), policy),
      'WAITING_FOR_EMAIL',
      'TRIGGERING_EXPORT',
    ],
    [
      'Drive file adopted',
      emailFoundJob,
      (job) => adoptExistingBackup(job, at, sampleResult),
      'EMAIL_FOUND',
      'COMPLETE',
    ],
    [
      'download',
      emailFoundJob,
      (job) => markTransferProgress(job, at, 'DOWNLOADING'),
      'EMAIL_FOUND',
      'DOWNLOADING',
    ],
    [
      'verify',
      downloadingJob,
      (job) => markTransferProgress(job, at, 'VERIFYING'),
      'DOWNLOADING',
      'VERIFYING',
    ],
    [
      'upload',
      verifyingJob,
      (job) => markTransferProgress(job, at, 'UPLOADING'),
      'VERIFYING',
      'UPLOADING',
    ],
    [
      'checksum ok',
      uploadingJob,
      (job) => completeTransfer(job, at, sampleResult),
      'UPLOADING',
      'COMPLETE',
    ],
    [
      'link expired, attempt < 3',
      downloadingJob,
      (job) => recordLinkExpired(job, at, policy),
      'DOWNLOADING',
      'TRIGGERING_EXPORT',
    ],
    [
      'invalid ZIP, re-download once',
      verifyingJob,
      (job) => rollbackTransfer(job, at, 'zip_invalid', policy),
      'VERIFYING',
      'EMAIL_FOUND',
    ],
    [
      'orphaned (worker timeout)',
      uploadingJob,
      (job) => rollbackTransfer(job, at, 'orphaned', policy),
      'UPLOADING',
      'EMAIL_FOUND',
    ],
    [
      'transient, before click',
      triggeringJob,
      (job) => recordFailure(job, at, 'NOTION_UNAVAILABLE', policy),
      'TRIGGERING_EXPORT',
      'RETRYABLE_FAILURE',
    ],
    [
      'backoff elapsed',
      retryableJob,
      (job) => resumeAfterBackoff(job, at),
      'RETRYABLE_FAILURE',
      'TRIGGERING_EXPORT',
    ],
    [
      'session, challenge, UI, retries exhausted',
      triggeringJob,
      (job) => recordFailure(job, at, 'NOTION_SESSION_EXPIRED', policy),
      'TRIGGERING_EXPORT',
      'NEEDS_ATTENTION',
    ],
    [
      'backup_retry or supervisor retry_stage',
      () => attentionJob(),
      (job) => retryJob(job, at, policy),
      'NEEDS_ATTENTION',
      'TRIGGERING_EXPORT',
    ],
    [
      'lifetime 7 days',
      () => attentionJob(),
      (job) => failLifetimeExceeded(job, hoursAfter(168)),
      'NEEDS_ATTENTION',
      'FAILED',
    ],
    ['backup_cancel', waitingJob, (job) => cancelJob(job, at), 'WAITING_FOR_EMAIL', 'CANCELLED'],
    // Not drawn in the diagram:
    [
      'existing backup adopted before any export',
      triggeringJob,
      (job) => adoptExistingBackup(job, at, sampleResult),
      'TRIGGERING_EXPORT',
      'COMPLETE',
    ],
    [
      'link expired before the download',
      emailFoundJob,
      (job) => recordLinkExpired(job, at, policy),
      'EMAIL_FOUND',
      'TRIGGERING_EXPORT',
    ],
    [
      'second invalid ZIP, attempt < 3',
      () => ({ ...verifyingJob(), transferAttempt: 1 }),
      (job) => rollbackTransfer(job, at, 'zip_invalid', policy),
      'VERIFYING',
      'TRIGGERING_EXPORT',
    ],
  ];

  it.each(edges)('%s', (_label, build, apply, from, to) => {
    const before = build();

    expect(before.status).toBe(from);
    expect(valid(apply(before)).status).toBe(to);
  });
});

describe('write-ahead export', () => {
  it('saves exportClickAt before the click, once per attempt', () => {
    const job = clickedJob();

    expect(job.exportClickAt).toBe(minutesAfter(2).toISOString());
    expect(invalidState(() => markExportClick(job, minutesAfter(3)))).toBe(
      'EXPORT_ALREADY_CLICKED',
    );
  });

  it('uses the click time as the email search bound', () => {
    const job = recordExportRequested(clickedJob(), minutesAfter(4), 'confirmed');

    expect(job).toMatchObject({ emailCheckAttempt: 0, requestedAt: minutesAfter(2).toISOString() });
  });

  it('in doubt waits for the email from the click time, without clicking again', () => {
    const job = recordExportRequested(clickedJob(), minutesAfter(30), 'in_doubt');

    expect(job).toMatchObject({
      exportClickAt: minutesAfter(2).toISOString(),
      requestedAt: minutesAfter(2).toISOString(),
      status: 'WAITING_FOR_EMAIL',
    });
  });

  it('treats an export already in progress as confirmed, even before a click', () => {
    const job = recordExportRequested(triggeringJob(), minutesAfter(3), 'already_in_progress');

    expect(job).toMatchObject({
      requestedAt: minutesAfter(3).toISOString(),
      status: 'WAITING_FOR_EMAIL',
    });
  });

  it.each(['confirmed', 'in_doubt'] as const)('refuses %s without a saved click', (outcome) => {
    expect(
      invalidState(() => recordExportRequested(triggeringJob(), minutesAfter(3), outcome)),
    ).toBe('EXPORT_NOT_CLICKED');
  });

  it('clears the trigger stage retries once the export is requested', () => {
    const resumed = resumeAfterBackoff(retryableJob(), minutesAfter(10));
    const clicked = markExportClick(resumed, minutesAfter(11));

    expect(resumed.stageRetries).toEqual({ NOTION_TRIGGER: 1 });
    expect(recordExportRequested(clicked, minutesAfter(11), 'confirmed').stageRetries).toEqual({});
  });
});

describe('email wait', () => {
  it('counts each check that finds nothing', () => {
    const once = recordEmailNotFound(waitingJob(), minutesAfter(7), policy);
    const twice = recordEmailNotFound(once, minutesAfter(22), policy);

    expect([once.emailCheckAttempt, twice.emailCheckAttempt]).toEqual([1, 2]);
    expect(twice.status).toBe('WAITING_FOR_EMAIL');
  });

  it('starts a new export attempt after the wait limit, with every attempt field reset', () => {
    const found = recordEmailNotFound(waitingJob(), hoursAfter(48, minutesAfter(2)), policy);

    expect(found).toMatchObject({
      emailCheckAttempt: 0,
      exportAttempt: 2,
      status: 'TRIGGERING_EXPORT',
    });
    expect(found.exportClickAt).toBeUndefined();
    expect(found.requestedAt).toBeUndefined();
  });

  it('keeps waiting just before the wait limit', () => {
    const job = recordEmailNotFound(waitingJob(), minutesAfter(48 * 60 + 1), policy);

    expect(job.status).toBe('WAITING_FOR_EMAIL');
  });

  it('needs attention with EMAIL_TIMEOUT once no attempt is left', () => {
    const job = recordEmailNotFound(lastAttempt(waitingJob()), hoursAfter(49), policy);

    expect(valid(job)).toMatchObject({
      incident: { code: 'EMAIL_TIMEOUT', stage: 'EMAIL_WAIT', state: 'awaiting_supervisor' },
      resumeFrom: 'WAITING_FOR_EMAIL',
      status: 'NEEDS_ATTENTION',
    });
  });

  it('records the email and resets the transfer runs', () => {
    expect(emailFoundJob()).toMatchObject({
      emailMessageId: sampleEmail.messageId,
      emailReceivedAt: sampleEmail.receivedAt,
      transferAttempt: 0,
    });
  });
});

describe('transfer', () => {
  it('moves through the markers in order only', () => {
    expect(
      invalidState(() => markTransferProgress(emailFoundJob(), minutesAfter(8), 'VERIFYING')),
    ).toBe('UNEXPECTED_STATUS');
    expect(
      invalidState(() => markTransferProgress(downloadingJob(), minutesAfter(8), 'UPLOADING')),
    ).toBe('UNEXPECTED_STATUS');
  });

  it('completes with the result and clears retries', () => {
    expect(valid(completeTransfer(uploadingJob(), minutesAfter(9), sampleResult))).toMatchObject({
      completedAt: minutesAfter(9).toISOString(),
      result: sampleResult,
      stageRetries: {},
      status: 'COMPLETE',
    });
  });

  it('adopts an existing Drive backup before any export (Redis state lost)', () => {
    expect(adoptExistingBackup(triggeringJob(), minutesAfter(2), sampleResult).status).toBe(
      'COMPLETE',
    );
    expect(
      invalidState(() => adoptExistingBackup(waitingJob(), minutesAfter(3), sampleResult)),
    ).toBe('UNEXPECTED_STATUS');
  });

  it.each([
    ['orphaned', 'TRANSFER_TIMEOUT'],
    ['over_budget', 'TRANSFER_TIMEOUT'],
    ['checksum_mismatch', 'DRIVE_CHECKSUM_MISMATCH'],
  ] as const)('runs once more after %s, then needs attention with %s', (reason, code) => {
    const first = rollbackTransfer(uploadingJob(), minutesAfter(9), reason, policy);
    const again = markTransferProgress(
      markTransferProgress(
        markTransferProgress(first, minutesAfter(10), 'DOWNLOADING'),
        minutesAfter(10),
        'VERIFYING',
      ),
      minutesAfter(10),
      'UPLOADING',
    );
    const second = rollbackTransfer(again, minutesAfter(11), reason, policy);

    expect(valid(first)).toMatchObject({
      lastError: { code },
      status: 'EMAIL_FOUND',
      transferAttempt: 1,
    });
    expect(valid(second)).toMatchObject({
      incident: { code, stage: 'TRANSFER' },
      resumeFrom: 'EMAIL_FOUND',
      status: 'NEEDS_ATTENTION',
      transferAttempt: 2,
    });
  });

  it('starts a new export attempt after a second invalid ZIP, while attempts are left', () => {
    const job = { ...verifyingJob(), transferAttempt: 1 };

    expect(valid(rollbackTransfer(job, minutesAfter(9), 'zip_invalid', policy))).toMatchObject({
      exportAttempt: 2,
      status: 'TRIGGERING_EXPORT',
      transferAttempt: 0,
    });
    expect(
      rollbackTransfer(lastAttempt(job), minutesAfter(9), 'zip_invalid', policy),
    ).toMatchObject({
      incident: { code: 'ZIP_INVALID' },
      status: 'NEEDS_ATTENTION',
    });
  });

  it('rolls back progress markers only', () => {
    expect(
      invalidState(() => rollbackTransfer(emailFoundJob(), minutesAfter(9), 'orphaned', policy)),
    ).toBe('UNEXPECTED_STATUS');
  });

  it('starts a new export attempt when the link expired, or needs attention without one', () => {
    expect(recordLinkExpired(emailFoundJob(), minutesAfter(9), policy)).toMatchObject({
      emailMessageId: undefined,
      exportAttempt: 2,
      status: 'TRIGGERING_EXPORT',
    });
    expect(
      valid(recordLinkExpired(lastAttempt(downloadingJob()), minutesAfter(9), policy)),
    ).toMatchObject({
      incident: { code: 'DOWNLOAD_LINK_EXPIRED', stage: 'TRANSFER' },
      status: 'NEEDS_ATTENTION',
    });
  });
});

describe('export attempts', () => {
  it('refuses a new attempt once MAX_EXPORT_ATTEMPTS are used', () => {
    expect(
      invalidState(() => startNewExportAttempt(lastAttempt(waitingJob()), minutesAfter(9), policy)),
    ).toBe('EXPORT_ATTEMPTS_EXHAUSTED');
  });
});

describe('recordFailure', () => {
  it('retries a stage-budget error MAX_STAGE_RETRIES times, then needs attention', () => {
    const retried = failRepeatedly('NOTION_UNAVAILABLE', policy.maxStageRetries);
    const exhausted = recordFailure(retried, minutesAfter(30), 'NOTION_UNAVAILABLE', policy);

    expect(retried).toMatchObject({
      stageRetries: { NOTION_TRIGGER: 3 },
      status: 'TRIGGERING_EXPORT',
    });
    expect(valid(exhausted)).toMatchObject({
      incident: { code: 'NOTION_UNAVAILABLE', state: 'awaiting_supervisor' },
      status: 'NEEDS_ATTENTION',
    });
  });

  it('retries a window-budget error for about 24 h of backoff (8 retries)', () => {
    let job = waitingJob();

    for (let failure = 0; failure < 8; failure += 1) {
      job = recordFailure(job, minutesAfter(10), 'GMAIL_UNAVAILABLE', policy);
      expect(job.status).toBe('RETRYABLE_FAILURE');
      job = resumeAfterBackoff(job, minutesAfter(10));
    }

    expect(recordFailure(job, minutesAfter(10), 'GMAIL_UNAVAILABLE', policy).status).toBe(
      'NEEDS_ATTENTION',
    );
  });

  it('records the stage, the entry status to resume from, and the static message', () => {
    expect(
      valid(recordFailure(downloadingJob(), minutesAfter(9), 'DRIVE_UNAVAILABLE', policy)),
    ).toMatchObject({
      lastError: {
        code: 'DRIVE_UNAVAILABLE',
        message: 'The Drive API failed or rate-limited the request.',
        stage: 'TRANSFER',
      },
      resumeFrom: 'EMAIL_FOUND',
      stageRetries: { TRANSFER: 1 },
      status: 'RETRYABLE_FAILURE',
    });
  });

  it.each([
    'NOTION_SESSION_EXPIRED',
    'NOTION_INTERACTIVE_CHALLENGE',
    'NOTION_WRONG_WORKSPACE',
    'GOOGLE_AUTH_REQUIRED',
    'DRIVE_ROOT_INACCESSIBLE',
    'STATE_SCHEMA_INVALID',
    'CONFIG_INCOMPLETE',
  ] as const)('sends %s straight to a person, never to the supervisor', (code) => {
    expect(attentionJob(code).incident).toMatchObject({
      code,
      occurrences: 1,
      state: 'awaiting_user',
    });
  });

  it.each(['NOTION_UI_CHANGED', 'UNKNOWN_ERROR', 'INTEGRATION_UNCLASSIFIED'] as const)(
    'sends %s to the supervisor first',
    (code) => {
      expect(attentionJob(code).incident?.state).toBe('awaiting_supervisor');
    },
  );

  it('reopens the same incident on a repeated failure, keeping its history', () => {
    const first = attentionJob('NOTION_UI_CHANGED');
    const withDecision: BackupJob = {
      ...first,
      incident: {
        ...first.incident!,
        decisions: [{ action: 'retry_stage', at: minutesAfter(4).toISOString() }],
      },
    };
    const retried = retryJob(withDecision, minutesAfter(5), policy);
    // backup_retry closes the incident; a supervisor retry_stage keeps it (simulated here).
    const supervisorRetry = { ...retried, incident: withDecision.incident };
    const again = recordFailure(supervisorRetry, minutesAfter(6), 'NOTION_UI_CHANGED', policy);

    expect(retried.incident).toBeUndefined();
    expect(again.incident).toMatchObject({
      decisions: [{ action: 'retry_stage' }],
      occurrences: 2,
      openedAt: first.incident?.openedAt,
    });
  });

  it.each(['RETRYABLE_FAILURE', 'NEEDS_ATTENTION', 'COMPLETE', 'FAILED', 'CANCELLED'] as const)(
    'refuses to record a failure in %s',
    (status) => {
      expect(() =>
        recordFailure(jobInStatus(status), minutesAfter(30), 'UNKNOWN_ERROR', policy),
      ).toThrow(InvalidJobStateError);
    },
  );
});

describe('backup_retry', () => {
  it('returns to the failed stage, resets its retries and closes the incident', () => {
    const job = valid(retryJob(attentionJob('NOTION_UI_CHANGED'), minutesAfter(10), policy));

    expect(job.status).toBe('TRIGGERING_EXPORT');
    expect(job.incident).toBeUndefined();
    expect(job.resumeFrom).toBeUndefined();
  });

  it('can retry from an earlier stage', () => {
    const failed = recordFailure(
      downloadingJob(),
      minutesAfter(9),
      'TMP_SPACE_INSUFFICIENT',
      policy,
    );

    expect(retryJob(failed, minutesAfter(10), policy, 'EMAIL_WAIT').status).toBe(
      'WAITING_FOR_EMAIL',
    );
    expect(retryJob(failed, minutesAfter(10), policy).status).toBe('EMAIL_FOUND');
  });

  it('refuses a stage the job never reached', () => {
    expect(invalidState(() => retryJob(attentionJob(), minutesAfter(10), policy, 'TRANSFER'))).toBe(
      'STAGE_NOT_REACHED',
    );
    expect(
      invalidState(() => retryJob(attentionJob(), minutesAfter(10), policy, 'EMAIL_WAIT')),
    ).toBe('STAGE_NOT_REACHED');
  });

  it('starts a new export attempt when NOTION_TRIGGER is retried after this attempt clicked', () => {
    const timedOut = recordFailure(waitingJob(), minutesAfter(30), 'EMAIL_TIMEOUT', policy);
    const fromScratch = valid(retryJob(timedOut, minutesAfter(31), policy, 'NOTION_TRIGGER'));

    expect(fromScratch).toMatchObject({ exportAttempt: 2, status: 'TRIGGERING_EXPORT' });
    expect(fromScratch.exportClickAt).toBeUndefined();
    expect(fromScratch.requestedAt).toBeUndefined();
    expect(fromScratch.incident).toBeUndefined();
    expect(
      invalidState(() =>
        retryJob(
          { ...timedOut, exportAttempt: policy.maxExportAttempts },
          minutesAfter(31),
          policy,
          'NOTION_TRIGGER',
        ),
      ),
    ).toBe('EXPORT_ATTEMPTS_EXHAUSTED');
  });

  it('keeps the attempt when NOTION_TRIGGER is retried before any click', () => {
    const retried = retryJob(
      attentionJob('NOTION_UI_CHANGED'),
      minutesAfter(10),
      policy,
      'NOTION_TRIGGER',
    );

    expect(retried).toMatchObject({ exportAttempt: 1, status: 'TRIGGERING_EXPORT' });
  });

  it('works only from NEEDS_ATTENTION or RETRYABLE_FAILURE', () => {
    expect(retryJob(retryableJob(), minutesAfter(4), policy).stageRetries).toEqual({});
    expect(invalidState(() => retryJob(waitingJob(), minutesAfter(10), policy))).toBe(
      'UNEXPECTED_STATUS',
    );
    expect(invalidState(() => retryJob(jobInStatus('COMPLETE'), minutesAfter(10), policy))).toBe(
      'JOB_TERMINAL',
    );
  });
});

describe('retryIncident', () => {
  it('retries the job while it has the incident it was given', () => {
    const job = attentionJob('NOTION_SESSION_EXPIRED');
    const incident = job.incident ?? expect.fail('no incident');

    expect(retryIncident(job, minutesAfter(10), policy, incident)).toEqual(
      retryJob(job, minutesAfter(10), policy),
    );
  });

  it.each<[string, (incident: Incident) => Incident]>([
    ['another code', (incident) => ({ ...incident, code: 'NOTION_WRONG_WORKSPACE' })],
    ['another stage', (incident) => ({ ...incident, stage: 'TRANSFER' })],
    ['a later opening', (incident) => ({ ...incident, openedAt: minutesAfter(5).toISOString() })],
    ['another occurrence', (incident) => ({ ...incident, occurrences: incident.occurrences + 1 })],
    ['another state', (incident) => ({ ...incident, state: 'awaiting_supervisor' })],
  ])('refuses once the job has an incident with %s', (_, change) => {
    const job = attentionJob('NOTION_SESSION_EXPIRED');
    const read = job.incident ?? expect.fail('no incident');
    const newer = { ...job, incident: change(read) };

    expect(invalidState(() => retryIncident(newer, minutesAfter(10), policy, read))).toBe(
      'INCIDENT_CHANGED',
    );
  });

  it('refuses a job whose incident is closed', () => {
    const job = attentionJob('NOTION_SESSION_EXPIRED');
    const read = job.incident ?? expect.fail('no incident');
    const retried = retryJob(job, minutesAfter(10), policy);

    expect(invalidState(() => retryIncident(retried, minutesAfter(11), policy, read))).toBe(
      'INCIDENT_CHANGED',
    );
  });
});

describe('handOverToUser', () => {
  it('moves a supervised incident to the user, keeping the job and its history', () => {
    const supervised = attentionJob('NOTION_UI_CHANGED');
    const handedOver = valid(handOverToUser(supervised, minutesAfter(4)));

    expect(supervised.incident?.state).toBe('awaiting_supervisor');
    expect(handedOver.status).toBe('NEEDS_ATTENTION');
    expect(handedOver.incident).toEqual({ ...supervised.incident, state: 'awaiting_user' });
  });

  it('works only on a job that needs attention', () => {
    expect(invalidState(() => handOverToUser(waitingJob(), minutesAfter(4)))).toBe(
      'UNEXPECTED_STATUS',
    );
  });
});

describe('cancellation', () => {
  it('records the request once, for the next step boundary', () => {
    const requested = requestCancel(downloadingJob(), minutesAfter(9));

    expect(requested.cancelRequestedAt).toBe(minutesAfter(9).toISOString());
    expect(requestCancel(requested, minutesAfter(10))).toBe(requested);
  });

  it.each(nonTerminal)('cancels a job in %s', (status) => {
    expect(valid(cancelJob(jobInStatus(status), minutesAfter(500))).status).toBe('CANCELLED');
  });

  it.each(['COMPLETE', 'FAILED', 'CANCELLED'] as const)('cannot cancel a %s job', (status) => {
    expect(invalidState(() => cancelJob(jobInStatus(status), minutesAfter(500)))).toBe(
      'JOB_TERMINAL',
    );
    expect(invalidState(() => requestCancel(jobInStatus(status), minutesAfter(500)))).toBe(
      'JOB_TERMINAL',
    );
  });
});

describe('lifetime', () => {
  it('is exceeded after JOB_MAX_LIFETIME_HOURS for non-terminal jobs only', () => {
    expect(isLifetimeExceeded(waitingJob(), hoursAfter(167.9), policy)).toBe(false);
    expect(isLifetimeExceeded(waitingJob(), hoursAfter(168), policy)).toBe(true);
    expect(isLifetimeExceeded(jobInStatus('COMPLETE'), hoursAfter(500), policy)).toBe(false);
  });

  it.each(nonTerminal)('fails a job in %s with JOB_LIFETIME_EXCEEDED', (status) => {
    expect(valid(failLifetimeExceeded(jobInStatus(status), hoursAfter(168)))).toMatchObject({
      lastError: { code: 'JOB_LIFETIME_EXCEEDED' },
      status: 'FAILED',
    });
  });
});

describe('the job builders', () => {
  it.each(jobStatuses)('produce a valid job in %s', (status) => {
    expect(valid(jobInStatus(status)).status).toBe(status);
  });

  it('start at T0', () => {
    expect(createdJob().createdAt).toBe(T0.toISOString());
    expect(beginExportTrigger(createdJob(), minutesAfter(1)).updatedAt).toBe(
      minutesAfter(1).toISOString(),
    );
  });
});
