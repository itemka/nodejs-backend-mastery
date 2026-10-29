import type { AgentDecision, AgentModel } from '../../src/agent/agent-model.js';
import type { AgentContext } from '../../src/agent/context-builder.js';
import type { ErrorCode } from '../../src/domain/error-catalog.js';
import { errorCatalog } from '../../src/domain/error-catalog.js';
import type { AgentActionName, BackupJob } from '../../src/domain/job.js';
import { newBackupJob } from '../../src/domain/job.js';
import type { BackupHarness } from './backup-harness.js';
import { attentionJob, valid } from './jobs.js';

/** One scripted answer: a raw decision, a thrown error, or a call that never answers. */
export type ScriptStep = 'hang' | Error | Record<string, unknown>;

/** A model that answers from a script and records every context it was given. */
export class ScriptedAgentModel implements AgentModel {
  readonly contexts: AgentContext[] = [];
  readonly id = 'scripted';
  /** The next answers; a `notify_user` once they run out. */
  script: ScriptStep[] = [];

  decide(context: AgentContext, signal: AbortSignal): Promise<unknown> {
    this.contexts.push(context);

    const next = this.script.shift() ?? decision('notify_user', { summary: 'Script ended.' });

    if (next === 'hang') {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
    }

    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

export function decision(
  action: AgentActionName,
  params: AgentDecision['params'] = {},
  confidence: AgentDecision['confidence'] = 'high',
): AgentDecision {
  return { action, confidence, params, rationale: `Chose ${action} from the context.` };
}

export const SEEDED_TOKEN = 'token-seeded-0000001';

/** A job that needs attention with `code`, stored with a wakeup token the test can deliver. */
export function supervisedJob(code: ErrorCode, changes: Partial<BackupJob> = {}): BackupJob {
  const base = attentionJob('UNKNOWN_ERROR');
  const incident = base.incident!;

  return valid({
    ...base,
    incident: {
      ...incident,
      code,
      state: errorCatalog[code].supervised ? 'awaiting_supervisor' : 'awaiting_user',
    },
    lastError: { ...base.lastError!, code, message: errorCatalog[code].description },
    schedule: { notBefore: base.updatedAt, token: SEEDED_TOKEN },
    ...changes,
  });
}

/** Stores `job` in the harness as it is, the way the worker would find it. */
export async function seedJob(
  harness: Pick<BackupHarness, 'memory'>,
  job: BackupJob,
): Promise<void> {
  const created = valid({
    ...newBackupJob({ kind: job.kind, now: new Date(job.createdAt), period: job.period }),
    id: job.id,
  });

  await harness.memory.create(created);
  await harness.memory.update(job.id, 1, job);
}

/** Delivers the seeded wakeup, as QStash would. */
export function deliverSeeded(harness: BackupHarness, jobId = '2026-10') {
  return harness.processJob.execute({ jobId, reason: 'supervisor', token: SEEDED_TOKEN });
}
