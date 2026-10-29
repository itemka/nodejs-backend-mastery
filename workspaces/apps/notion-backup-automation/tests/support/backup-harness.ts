import { createHash } from 'node:crypto';

import { NoopAgentModel } from '../../src/adapters/llm/noop-agent-model.js';
import { InMemoryJobRepository } from '../../src/adapters/persistence/in-memory-job-repository.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisHealthStore } from '../../src/adapters/persistence/redis-health-store.js';
import { InMemoryNotificationGate } from '../../src/adapters/persistence/redis-notification-gate.js';
import { RedisRateLimiter } from '../../src/adapters/persistence/redis-rate-limiter.js';
import type { AgentModel } from '../../src/agent/agent-model.js';
import type { AgentLimits } from '../../src/agent/limits.js';
import { defaultAgentLimits } from '../../src/agent/limits.js';
import { Supervisor } from '../../src/agent/supervisor.js';
import { BackupApplicationService } from '../../src/application/backup-service.js';
import type { IntegrationError } from '../../src/application/integration-error.js';
import { JobNotifications } from '../../src/application/job-notifications.js';
import type {
  BackupQuery,
  CreateJobResult,
  ExportEmailFinder,
  ExportEmailSearch,
  ExportEmailSearchResult,
  ExportRequest,
  ExportTransfer,
  ExportTriggerOutcome,
  JobRepository,
  LeaseResult,
  NotionExportTrigger,
  Notifier,
  Scheduler,
  SessionProbe,
  StoredBackup,
  StoredJob,
  TransferRequest,
  TransferResult,
  UpdateJobResult,
  Wakeup,
} from '../../src/application/ports.js';
import type { TickResult } from '../../src/application/process-job.js';
import { ProcessJobUseCase } from '../../src/application/process-job.js';
import type { JobEvent } from '../../src/domain/job-event.js';
import type { BackupJob } from '../../src/domain/job.js';
import type { LeaseKind } from '../../src/domain/next-step.js';
import type { Period } from '../../src/domain/period.js';
import type { BackupPolicy } from '../../src/domain/policy.js';
import { defaultBackupPolicy } from '../../src/domain/policy.js';
import type { TransferMarker } from '../../src/domain/statuses.js';
import type { IdGenerator } from '../../src/shared/ids.js';
import { createLogger } from '../../src/shared/logger.js';
import { SecretValue } from '../../src/shared/secret-value.js';
import { FakeRedis } from './fake-redis.js';
import { ManualClock } from './manual-clock.js';

const MINUTE_MS = 60_000;

/** The process died: nothing else it would have done happens. */
export class Crash extends Error {
  constructor() {
    super('The worker process died');
    this.name = 'Crash';
  }
}

/** Whether the current invocation is still alive. Every fake refuses to act for a dead one. */
export class World {
  dead = false;

  assertAlive(): void {
    if (this.dead) {
      throw new Crash();
    }
  }
}

/** Tokens and IDs in order, so tests can name them. */
export function sequentialIds(): IdGenerator & { tokens: string[] } {
  let next = 0;
  const tokens: string[] = [];

  return {
    shortId: () => {
      next += 1;

      return next.toString(16).padStart(16, '0');
    },
    token: () => {
      next += 1;

      const token = `token-${String(next).padStart(10, '0')}`;

      tokens.push(token);

      return token;
    },
    tokens,
  };
}

/**
 * The in-memory repository, with crashes: after the `crashAfterUpdate`-th successful update the
 * invocation dies. A dead invocation neither writes nor releases its lease, as a killed function.
 */
export class CrashableRepository implements JobRepository {
  crashAfterUpdate: number | undefined;
  /** Fails one update with this error when it matches; the write does not happen. */
  failUpdate: ((next: BackupJob) => Error | undefined) | undefined;
  updates = 0;
  private readonly inner: InMemoryJobRepository;
  private readonly world: World;

  constructor(inner: InMemoryJobRepository, world: World) {
    this.inner = inner;
    this.world = world;
  }

  acquireLease(jobId: string, workerId: string, ttlMs: number): Promise<LeaseResult> {
    this.world.assertAlive();

    return this.inner.acquireLease(jobId, workerId, ttlMs);
  }

  appendEvent(jobId: string, event: JobEvent): Promise<void> {
    this.world.assertAlive();

    return this.inner.appendEvent(jobId, event);
  }

  create(job: BackupJob): Promise<CreateJobResult> {
    this.world.assertAlive();

    return this.inner.create(job);
  }

  findActive(): Promise<StoredJob | undefined> {
    this.world.assertAlive();

    return this.inner.findActive();
  }

  get(jobId: string): Promise<StoredJob | undefined> {
    this.world.assertAlive();

    return this.inner.get(jobId);
  }

  list(options: { limit: number }): Promise<StoredJob[]> {
    this.world.assertAlive();

    return this.inner.list(options);
  }

  listEvents(jobId: string, options: { limit: number }): Promise<JobEvent[]> {
    this.world.assertAlive();

    return this.inner.listEvents(jobId, options);
  }

  markEmailConsumed(messageId: string, jobId: string): Promise<{ ownerJobId: string }> {
    this.world.assertAlive();

    return this.inner.markEmailConsumed(messageId, jobId);
  }

  releaseLease(jobId: string, workerId: string): Promise<boolean> {
    // A killed worker never releases its lease; it expires by its TTL.
    return this.world.dead ? Promise.resolve(false) : this.inner.releaseLease(jobId, workerId);
  }

  async update(jobId: string, expectedVersion: number, next: BackupJob): Promise<UpdateJobResult> {
    this.world.assertAlive();

    const failure = this.failUpdate?.(next);

    if (failure !== undefined) {
      this.failUpdate = undefined;

      throw failure;
    }

    const result = await this.inner.update(jobId, expectedVersion, next);

    if (result.outcome === 'updated') {
      this.updates += 1;

      if (this.updates === this.crashAfterUpdate) {
        this.world.dead = true;

        throw new Crash();
      }
    }

    return result;
  }
}

export interface PublishedWakeup extends Wakeup {
  readonly at: string;
  readonly messageId: string;
}

interface PendingMessage {
  attempts: number;
  dueAtMs: number;
  readonly messageId: string;
  readonly wakeup: Wakeup;
}

export interface Delivery {
  readonly at: string;
  readonly messageId: string;
  readonly result: TickResult | 'failed';
  readonly token: string;
}

/**
 * QStash as the tick sees it: published wakeups are delivered in due order. A 503 is delivered
 * again after `Retry-After`; a delivery that throws (a 500) is retried 3 times with backoff,
 * then dropped (the DLQ). Every delivery is a new invocation.
 */
export class FakeQStash implements Scheduler {
  readonly cancelled: string[] = [];
  readonly deliveries: Delivery[] = [];
  readonly dlq: PublishedWakeup[] = [];
  /**
   * Runs inside `schedule`, before it returns: QStash delivering a message before the publisher
   * has saved its token. The message also stays pending, as QStash would redeliver it.
   */
  onPublish: ((wakeup: Wakeup) => Promise<void>) | undefined;
  /** The next this-many publishes fail. */
  publishFailures = 0;
  readonly published: PublishedWakeup[] = [];
  private readonly clock: ManualClock;
  private pending: PendingMessage[] = [];
  private readonly world: World;

  constructor(clock: ManualClock, world: World) {
    this.clock = clock;
    this.world = world;
  }

  cancel(messageId: string): Promise<void> {
    this.cancelled.push(messageId);
    this.pending = this.pending.filter((message) => message.messageId !== messageId);

    return Promise.resolve();
  }

  /** Delivers every message, including the ones the ticks publish, until none is left. */
  async drain(useCase: ProcessJobUseCase, maxDeliveries = 2000): Promise<void> {
    for (let count = 0; this.pending.length > 0; count += 1) {
      if (count >= maxDeliveries) {
        throw new Error('The job did not settle');
      }

      await this.deliverNext(useCase);
    }
  }

  /** Delivers the next due message, moving the clock to its due time. */
  async deliverNext(useCase: ProcessJobUseCase): Promise<Delivery | undefined> {
    this.pending.sort((a, b) => a.dueAtMs - b.dueAtMs);

    const message = this.pending.shift();

    if (message === undefined) {
      return undefined;
    }

    const wait = message.dueAtMs - this.clock.now().getTime();

    if (wait > 0) {
      this.clock.advance(wait);
    }

    let result: Delivery['result'];

    try {
      result = await useCase.execute(message.wakeup);
    } catch {
      result = 'failed';
    } finally {
      this.world.dead = false;
    }

    const delivery: Delivery = {
      at: this.clock.now().toISOString(),
      messageId: message.messageId,
      result,
      token: message.wakeup.token,
    };

    this.deliveries.push(delivery);

    if (result === 'failed') {
      message.attempts += 1;

      if (message.attempts > 3) {
        this.dlq.push(this.publishedMessage(message.messageId));
      } else {
        message.dueAtMs = this.clock.now().getTime() + message.attempts * MINUTE_MS;
        this.pending.push(message);
      }
    } else if (result.outcome === 'lease_held') {
      message.dueAtMs = this.clock.now().getTime() + result.retryAfterSec * 1000;
      this.pending.push(message);
    }

    return delivery;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  async schedule(wakeup: Wakeup): Promise<{ messageId: string }> {
    this.world.assertAlive();

    if (this.publishFailures > 0) {
      this.publishFailures -= 1;

      throw new Error('QStash unavailable');
    }

    const messageId = `msg-${this.published.length + 1}`;

    this.published.push({ ...wakeup, at: this.clock.now().toISOString(), messageId });
    this.pending.push({
      attempts: 0,
      dueAtMs: this.clock.now().getTime() + wakeup.delaySec * 1000,
      messageId,
      wakeup,
    });
    await this.onPublish?.(wakeup);

    return { messageId };
  }

  private publishedMessage(messageId: string): PublishedWakeup {
    const found = this.published.find((message) => message.messageId === messageId);

    if (found === undefined) {
      throw new Error(`Unknown message ${messageId}`);
    }

    return found;
  }
}

interface ArrivedEmail {
  readonly messageId: string;
  readonly receivedAtMs: number;
}

/** Gmail: an export email arrives a few minutes after each real click. */
export class FakeEmails implements ExportEmailFinder {
  readonly arrived: ArrivedEmail[] = [];
  /** How long after a click Notion's email arrives. */
  delayMs = 4 * MINUTE_MS;
  /** The next searches fail with these. */
  failures: IntegrationError[] = [];
  readonly searches: ExportEmailSearch[] = [];
  private readonly clock: ManualClock;
  private readonly world: World;

  constructor(clock: ManualClock, world: World) {
    this.clock = clock;
    this.world = world;
  }

  /** Notion's email for an export clicked at `clickedAtMs`. */
  arriveFor(clickedAtMs: number): string {
    const messageId = `email${String(this.arrived.length + 1).padStart(4, '0')}`;

    this.arrived.push({ messageId, receivedAtMs: clickedAtMs + this.delayMs });

    return messageId;
  }

  findReadyEmail(search: ExportEmailSearch): Promise<ExportEmailSearchResult> {
    this.world.assertAlive();
    this.searches.push({ ...search, excludeIds: [...search.excludeIds] });

    const failure = this.failures.shift();

    if (failure !== undefined) {
      return Promise.reject(failure);
    }

    const now = this.clock.now().getTime();
    const notBefore = search.requestedAfter.getTime() - 10 * MINUTE_MS;
    const [newest] = this.arrived
      .filter(
        (email) =>
          email.receivedAtMs <= now &&
          email.receivedAtMs >= notBefore &&
          !search.excludeIds.includes(email.messageId),
      )
      .toSorted((a, b) => b.receivedAtMs - a.receivedAtMs);

    return Promise.resolve(
      newest === undefined
        ? { rejected: {}, status: 'not_found' }
        : {
            email: {
              messageId: newest.messageId,
              receivedAt: new Date(newest.receivedAtMs).toISOString(),
            },
            status: 'found',
          },
    );
  }

  getDownloadLink(): Promise<SecretValue<string>> {
    return Promise.resolve(new SecretValue('https://mg.mail.notion.com/c/fake'));
  }
}

type TriggerScript = ExportTriggerOutcome | IntegrationError;

/** Notion's Settings: scripted outcomes, and every final click recorded with its time. */
export class FakeTrigger implements Pick<NotionExportTrigger, 'probeSession' | 'requestExport'> {
  /** Runs before the write-ahead marker, so a test can act while the worker is "in the browser". */
  beforeClick: (() => Promise<void>) | undefined;
  readonly clicks: string[] = [];
  /** The next session probes fail with these; then the session is valid. */
  probeFailures: IntegrationError[] = [];
  probes = 0;
  /** The next outcomes; `confirmed` once they run out. */
  script: TriggerScript[] = [];
  private readonly clock: ManualClock;
  private readonly emails: FakeEmails;
  private readonly world: World;

  constructor(clock: ManualClock, world: World, emails: FakeEmails) {
    this.clock = clock;
    this.emails = emails;
    this.world = world;
  }

  probeSession(): Promise<SessionProbe> {
    this.world.assertAlive();
    this.probes += 1;

    const failure = this.probeFailures.shift();

    return failure === undefined ? Promise.resolve({ state: 'valid' }) : Promise.reject(failure);
  }

  async requestExport({
    onBeforeFinalClick,
  }: ExportRequest): Promise<{ outcome: ExportTriggerOutcome }> {
    this.world.assertAlive();

    const next = this.script.shift() ?? 'confirmed';

    if (typeof next !== 'string') {
      throw next;
    }

    if (next === 'already_in_progress') {
      return { outcome: next };
    }

    await this.beforeClick?.();
    await onBeforeFinalClick();
    this.world.assertAlive();

    const at = this.clock.now().getTime();

    this.clicks.push(new Date(at).toISOString());
    this.emails.arriveFor(at);

    return { outcome: next };
  }
}

export interface DriveBackup extends StoredBackup {
  readonly period: Period;
}

/** Drive: verified backups by period. */
export class FakeDrive {
  readonly backups: DriveBackup[] = [];
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  findExisting(query: BackupQuery): Promise<StoredBackup | undefined> {
    this.world.assertAlive();

    const found = this.backups.findLast(
      (backup) =>
        backup.period === query.period &&
        (query.jobId === undefined || backup.jobId === query.jobId) &&
        (query.sha256 === undefined || backup.sha256 === query.sha256),
    );

    return Promise.resolve(found);
  }
}

type TransferScript =
  | 'hang'
  | 'link_expired'
  | { readonly at: TransferMarker; readonly error: Error };

/**
 * The transfer: the three progress markers through `onStep`, then the upload into the fake
 * Drive. The same email always yields the same ZIP, and a ZIP Drive already holds is reused.
 */
export class FakeTransfer implements ExportTransfer {
  /** The ZIP the next exports contain. */
  exportSize = { entryCount: 198, sizeBytes: 8_907_221 };
  readonly runs: Omit<TransferRequest, 'onStep' | 'signal'>[] = [];
  /** The next runs end this way; a normal run once they run out. */
  script: TransferScript[] = [];
  private readonly drive: FakeDrive;
  private readonly world: World;

  constructor(world: World, drive: FakeDrive) {
    this.drive = drive;
    this.world = world;
  }

  async run(request: TransferRequest): Promise<TransferResult> {
    this.world.assertAlive();

    const { onStep, signal, ...rest } = request;

    this.runs.push(rest);

    const next = this.script.shift();

    if (next === 'link_expired') {
      return { outcome: 'link_expired' };
    }

    for (const marker of ['DOWNLOADING', 'VERIFYING', 'UPLOADING'] as const) {
      await onStep?.(marker);
      this.world.assertAlive();

      if (next === 'hang') {
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        });
      }

      if (typeof next === 'object' && next.at === marker) {
        throw next.error;
      }
    }

    const sha256 = createHash('sha256').update(request.emailMessageId).digest('hex');
    const existing = this.drive.backups.find((backup) => backup.sha256 === sha256);
    const backup: DriveBackup = existing ?? {
      driveFileId: `drive${this.drive.backups.length + 1}`,
      fileName: request.fileName,
      jobId: request.jobId,
      period: request.period,
      sha256,
      sizeBytes: this.exportSize.sizeBytes,
      yearFolderId: 'year2026',
    };

    if (existing === undefined) {
      this.drive.backups.push(backup);
    }

    return {
      backup: { ...backup, sidecar: 'written', uploaded: existing === undefined },
      entryCount: this.exportSize.entryCount,
      outcome: 'stored',
    };
  }
}

export interface NotificationRecord {
  kind: keyof Notifier;
  notification: unknown;
}

export interface HarnessOptions {
  agentLimits?: AgentLimits;
  budgetsMs?: Readonly<Record<LeaseKind, number>>;
  exportShrinkRatio?: number;
  /** The supervisor's model; `NoopAgentModel` (provider `none`) by default. */
  model?: AgentModel;
  policy?: BackupPolicy;
  start?: string;
}

/** Every application piece wired to the fakes; the clock starts on 2026-10-01 06:00 Warsaw. */
export function backupHarness(options: HarnessOptions = {}) {
  const clock = new ManualClock(options.start ?? '2026-10-01T04:00:00.000Z');
  const world = new World();
  const ids = sequentialIds();
  const memory = new InMemoryJobRepository(clock);
  const jobs = new CrashableRepository(memory, world);
  const qstash = new FakeQStash(clock, world);
  const drive = new FakeDrive(world);
  const emails = new FakeEmails(clock, world);
  const trigger = new FakeTrigger(clock, world, emails);
  const transfer = new FakeTransfer(world, drive);
  const policy = options.policy ?? defaultBackupPolicy;
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger({
    clock,
    level: 'debug',
    sink: (_level, line) => {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const sent: NotificationRecord[] = [];

  const deliver = (kind: keyof Notifier) => (notification: unknown) => {
    world.assertAlive();
    sent.push({ kind, notification });

    return Promise.resolve();
  };

  const notifier: Notifier = {
    attention: deliver('attention'),
    failure: deliver('failure'),
    loginWarning: deliver('loginWarning'),
    success: deliver('success'),
  };
  const gate = new InMemoryNotificationGate(clock);
  const redis = new FakeRedis();
  const health = new RedisHealthStore(redis, keyPrefixFor('test'));
  const limiter = new RedisRateLimiter(redis, keyPrefixFor('test'), clock);
  const supervisor = new Supervisor({
    clock,
    limiter,
    limits: options.agentLimits ?? defaultAgentLimits,
    logger,
    model: options.model ?? new NoopAgentModel(),
    policy,
    workspaceName: 'Acme Workspace',
  });
  const notifications = new JobNotifications({
    clock,
    devFolder: false,
    gate,
    health,
    jobs,
    logger,
    notifier,
    policy,
  });
  const processJob = new ProcessJobUseCase({
    clock,
    emails,
    exportShrinkRatio: options.exportShrinkRatio ?? 0.5,
    health,
    ids,
    jobs,
    logger,
    notifications,
    policy,
    scheduler: qstash,
    storage: drive,
    supervisor,
    timeZone: 'Europe/Warsaw',
    transfer,
    trigger,
    ...(options.budgetsMs === undefined ? {} : { budgetsMs: options.budgetsMs }),
  });
  const service = new BackupApplicationService({
    clock,
    ids,
    jobs,
    logger,
    policy,
    scheduler: qstash,
    timeZone: 'Europe/Warsaw',
  });

  return {
    clock,
    drain: () => qstash.drain(processJob),
    drive,
    emails,
    gate,
    health,
    ids,
    jobs,
    limiter,
    logger,
    logs,
    memory,
    notifications,
    policy,
    processJob,
    qstash,
    sent,
    service,
    transfer,
    trigger,
    world,
  };
}

export type BackupHarness = ReturnType<typeof backupHarness>;

/** The stored job, which must exist. */
export async function storedJob(harness: BackupHarness, jobId: string): Promise<BackupJob> {
  const stored = await harness.memory.get(jobId);

  if (stored === undefined) {
    throw new Error(`No job ${jobId}`);
  }

  return stored.job;
}
