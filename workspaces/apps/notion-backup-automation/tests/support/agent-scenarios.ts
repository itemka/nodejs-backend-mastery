import type { ContextInput } from '../../src/agent/context-builder.js';
import { defaultAgentLimits } from '../../src/agent/limits.js';
import type { HealthSnapshot } from '../../src/application/health-snapshot.js';
import type { ErrorCode } from '../../src/domain/error-catalog.js';
import type { JobEvent } from '../../src/domain/job-event.js';
import {
  markExportClick,
  markTransferProgress,
  recordEmailFound,
  recordEmailNotFound,
  recordExportRequested,
  recordFailure,
  recordLinkExpired,
  recordSupervisorDecision,
  resumeAfterBackoff,
  supervisorRetryStage,
} from '../../src/domain/job-lifecycle.js';
import type { BackupJob } from '../../src/domain/job.js';
import { stageOf } from '../../src/domain/job.js';
import { retryBackoffSec } from '../../src/domain/retry-policy.js';
import {
  downloadingJob,
  hoursAfter,
  minutesAfter,
  policy,
  T0,
  triggeringJob,
  valid,
  waitingJob,
} from './jobs.js';

/*
 * The S5 incidents (`tests/fixtures/agent/*.json`), each reached through the lifecycle rules
 * from a new job, so a fixture shows a state production can be in. `buildAgentContext` turns
 * each into its fixture's context, the allowed actions included (tests/agent/fixtures.test.ts).
 */

/** A Settings dialog whose Export moved: what `collectUiLandmarks` would keep. */
const CHANGED_SETTINGS = [
  'dialog:Settings',
  'tab:Preferences',
  'tab:People',
  'tab:General',
  'heading:Workspace',
  'button:Download workspace data',
  'button:Cancel',
];

function input(job: BackupJob, now: Date, inspected?: ContextInput['inspected']): ContextInput {
  return {
    job: valid(job),
    limits: defaultAgentLimits,
    now,
    policy,
    ...(inspected === undefined ? {} : { inspected }),
  };
}

/** The supervisor's wakeup, a minute after `at`. */
function wakeup(at: Date): Date {
  return minutesAfter(1, at);
}

/** Fails with `code` from `at` on, through each backoff retry, until the job needs attention. */
function failUntilAttention(
  job: BackupJob,
  code: ErrorCode,
  at: Date,
): { readonly at: Date; readonly job: BackupJob } {
  let now = at;
  let current = recordFailure(job, now, code, policy);

  while (current.status === 'RETRYABLE_FAILURE') {
    const stage = stageOf(current)!;

    now = new Date(now.getTime() + retryBackoffSec(current.stageRetries[stage] ?? 1) * 1000);
    current = recordFailure(resumeAfterBackoff(current, now), now, code, policy);
  }

  return { at: now, job: current };
}

/** Clicks Export and records the request, as a confirmed export does. */
function requestExport(job: BackupJob, at: Date): BackupJob {
  return recordExportRequested(markExportClick(job, at), at, 'confirmed');
}

function notionUiChangedAfterRetry(): ContextInput {
  const failed = recordFailure(triggeringJob(), minutesAfter(3), 'NOTION_UI_CHANGED', policy, {
    uiLandmarks: CHANGED_SETTINGS,
  });
  const probed = recordSupervisorDecision(
    failed,
    minutesAfter(4),
    { action: 'check_notion_session', outcome: 'session:valid' },
    { notionSession: { checkedAt: minutesAfter(4).toISOString(), state: 'valid' } },
  );
  const retried = supervisorRetryStage(
    recordSupervisorDecision(probed, minutesAfter(5), {
      action: 'retry_stage',
      outcome: 'retrying',
    }),
    minutesAfter(5),
    policy,
  );
  // The retried stage fails the same way: the incident reopens with its decisions.
  const again = recordFailure(retried, minutesAfter(7), 'NOTION_UI_CHANGED', policy, {
    uiLandmarks: CHANGED_SETTINGS,
  });

  return input(again, wakeup(minutesAfter(7)));
}

function notionUnavailableExhausted(): ContextInput {
  const { at, job } = failUntilAttention(triggeringJob(), 'NOTION_UNAVAILABLE', minutesAfter(3));

  return input(job, wakeup(at));
}

function gmailUnavailableExhausted(): ContextInput {
  const checked = recordEmailNotFound(
    recordEmailNotFound(waitingJob(), minutesAfter(7), policy),
    minutesAfter(17),
    policy,
  );
  const { at, job } = failUntilAttention(checked, 'GMAIL_UNAVAILABLE', minutesAfter(32));

  return input(job, wakeup(at));
}

function emailUnrecognized(): ContextInput {
  const checked = recordEmailNotFound(
    recordEmailNotFound(waitingJob(), minutesAfter(7), policy),
    minutesAfter(17),
    policy,
  );

  return input(
    recordFailure(checked, minutesAfter(32), 'EMAIL_UNRECOGNIZED', policy),
    wakeup(minutesAfter(32)),
  );
}

function zipInvalidNoAttemptLeft(): ContextInput {
  let job = waitingJob();
  let at = minutesAfter(2);

  // Two attempts whose download links expired, then the last one's ZIP is invalid.
  for (let attempt = 1; attempt < policy.maxExportAttempts; attempt += 1) {
    at = hoursAfter(2, at);
    job = recordEmailFound(job, at, {
      messageId: `19a2f0a1b2c3d4e${attempt}`,
      receivedAt: at.toISOString(),
    });
    at = hoursAfter(1, at);
    job = requestExport(recordLinkExpired(job, at, policy), minutesAfter(5, at));
  }

  at = hoursAfter(2, at);

  const found = recordEmailFound(job, at, {
    messageId: '19a2f0a1b2c3d4e9',
    receivedAt: at.toISOString(),
  });
  const verifying = markTransferProgress(
    markTransferProgress(found, minutesAfter(1, at), 'DOWNLOADING'),
    minutesAfter(3, at),
    'VERIFYING',
  );

  return input(
    recordFailure(verifying, minutesAfter(4, at), 'ZIP_INVALID', policy),
    wakeup(minutesAfter(4, at)),
  );
}

function transferTimeoutFirst(): ContextInput {
  return input(
    recordFailure(downloadingJob(), minutesAfter(13), 'TRANSFER_TIMEOUT', policy),
    wakeup(minutesAfter(13)),
  );
}

function unknownErrorLastDecision(): ContextInput {
  const failed = recordFailure(triggeringJob(), minutesAfter(3), 'UNKNOWN_ERROR', policy);
  const inspected = recordSupervisorDecision(
    failed,
    minutesAfter(4),
    { action: 'inspect_status', outcome: 'inspected' },
    { inspectedAt: minutesAfter(4).toISOString() },
  );
  const probed = recordSupervisorDecision(
    inspected,
    minutesAfter(5),
    { action: 'check_notion_session', outcome: 'session:valid' },
    { notionSession: { checkedAt: minutesAfter(5).toISOString(), state: 'valid' } },
  );
  const timedOut = recordSupervisorDecision(probed, minutesAfter(6), {
    modelFailure: 'timeout',
    outcome: 'no_decision',
  });
  const events: JobEvent[] = [
    { at: T0.toISOString(), status: 'CREATED', text: 'CREATED (backup_start)', type: 'transition' },
    {
      at: minutesAfter(1).toISOString(),
      status: 'TRIGGERING_EXPORT',
      text: 'CREATED → TRIGGERING_EXPORT',
      type: 'transition',
    },
    {
      at: minutesAfter(3).toISOString(),
      code: 'UNKNOWN_ERROR',
      status: 'NEEDS_ATTENTION',
      text: 'TRIGGERING_EXPORT → NEEDS_ATTENTION (UNKNOWN_ERROR)',
      type: 'transition',
    },
    {
      at: minutesAfter(4).toISOString(),
      code: 'UNKNOWN_ERROR',
      text: 'supervisor · inspect_status → inspected',
      type: 'supervisor',
    },
  ];
  const health: HealthSnapshot = {
    cron: { ok: true, ranAt: T0.toISOString() },
    driveRoot: { checkedAt: T0.toISOString(), mode: 'existing', ok: true },
    google: { checkedAt: T0.toISOString(), scopes: [], tokenOk: true },
    notionSession: { checkedAt: T0.toISOString(), state: 'valid' },
  };

  return input(timedOut, minutesAfter(7), { events, health });
}

/** Each fixture's lifecycle, by file name. */
export const agentScenarios: Readonly<Record<string, () => ContextInput>> = {
  '01-notion-ui-changed-after-retry': notionUiChangedAfterRetry,
  '02-notion-unavailable-exhausted': notionUnavailableExhausted,
  '03-gmail-unavailable-exhausted': gmailUnavailableExhausted,
  '05-email-unrecognized': emailUnrecognized,
  '06-zip-invalid-no-attempt-left': zipInvalidNoAttemptLeft,
  '07-transfer-timeout-first': transferTimeoutFirst,
  '08-unknown-error-last-decision': unknownErrorLastDecision,
};
