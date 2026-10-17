import type {
  CreateJobResult,
  JobRepository,
  LeaseResult,
  StoredJob,
  UpdateJobResult,
} from '../../application/ports.js';
import type { JobEvent } from '../../domain/job-event.js';
import { MAX_JOB_EVENTS } from '../../domain/job-event.js';
import type { BackupJob } from '../../domain/job.js';
import { isTerminal } from '../../domain/statuses.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import {
  assertCreatable,
  assertSameJob,
  decodeEvents,
  decodeJob,
  encodeEvent,
  encodeJob,
} from './job-codec.js';

interface StoredRecord {
  createdAtMs: number;
  data: string;
  version: number;
}

/** Yields once, so concurrent calls interleave the way they do against a remote Redis. */
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * The in-memory `JobRepository` for tests and local runs. It keeps the Redis adapter's
 * semantics: records are stored as validated JSON, and every operation's check-and-write runs
 * in one synchronous turn, so it is atomic like a Lua script.
 */
export class InMemoryJobRepository implements JobRepository {
  private activeJobId: string | undefined;
  private readonly clock: Clock;
  private readonly emails = new Map<string, string>();
  private readonly events = new Map<string, string[]>();
  private readonly jobs = new Map<string, StoredRecord>();
  private readonly leases = new Map<string, { expiresAtMs: number; workerId: string }>();

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  async acquireLease(jobId: string, workerId: string, ttlMs: number): Promise<LeaseResult> {
    await nextTurn();

    const now = this.clock.now().getTime();
    const lease = this.leases.get(jobId);

    if (lease !== undefined && lease.expiresAtMs > now) {
      return { acquired: false, remainingMs: lease.expiresAtMs - now };
    }

    this.leases.set(jobId, { expiresAtMs: now + ttlMs, workerId });

    return { acquired: true };
  }

  async appendEvent(jobId: string, event: JobEvent): Promise<void> {
    const entry = encodeEvent(event, jobId);

    await nextTurn();

    const entries = [...(this.events.get(jobId) ?? []), entry];

    this.events.set(jobId, entries.slice(-MAX_JOB_EVENTS));
  }

  async create(job: BackupJob): Promise<CreateJobResult> {
    assertCreatable(job);

    const data = encodeJob(job);

    await nextTurn();

    const existing = this.jobs.get(job.id);

    if (existing !== undefined) {
      return { outcome: 'exists', stored: this.toStored(job.id, existing) };
    }

    if (this.activeJobId !== undefined) {
      return { activeJobId: this.activeJobId, outcome: 'active_exists' };
    }

    const record = { createdAtMs: Date.parse(job.createdAt), data, version: 1 };

    this.jobs.set(job.id, record);
    this.activeJobId = job.id;

    return { outcome: 'created', stored: this.toStored(job.id, record) };
  }

  async findActive(): Promise<StoredJob | undefined> {
    await nextTurn();

    return this.activeJobId === undefined ? undefined : this.read(this.activeJobId);
  }

  async get(jobId: string): Promise<StoredJob | undefined> {
    await nextTurn();

    return this.read(jobId);
  }

  async list({ limit }: { limit: number }): Promise<StoredJob[]> {
    await nextTurn();

    if (limit <= 0) {
      return [];
    }

    return [...this.jobs.entries()]
      .toSorted(([, a], [, b]) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit)
      .map(([id, record]) => this.toStored(id, record));
  }

  async listEvents(jobId: string, { limit }: { limit: number }): Promise<JobEvent[]> {
    await nextTurn();

    if (limit <= 0) {
      return [];
    }

    return decodeEvents((this.events.get(jobId) ?? []).slice(-limit));
  }

  async markEmailConsumed(messageId: string, jobId: string): Promise<{ ownerJobId: string }> {
    await nextTurn();

    const owner = this.emails.get(messageId);

    if (owner !== undefined) {
      return { ownerJobId: owner };
    }

    this.emails.set(messageId, jobId);

    return { ownerJobId: jobId };
  }

  async releaseLease(jobId: string, workerId: string): Promise<boolean> {
    await nextTurn();

    const lease = this.leases.get(jobId);

    // Redis has already dropped an expired lease, so releasing it reports false there too.
    if (lease?.workerId !== workerId || lease.expiresAtMs <= this.clock.now().getTime()) {
      return false;
    }

    this.leases.delete(jobId);

    return true;
  }

  async update(jobId: string, expectedVersion: number, next: BackupJob): Promise<UpdateJobResult> {
    assertSameJob(jobId, next);

    const data = encodeJob(next);

    await nextTurn();

    const record = this.jobs.get(jobId);

    if (record === undefined) {
      return { outcome: 'not_found' };
    }

    if (record.version !== expectedVersion) {
      return { outcome: 'conflict', version: record.version };
    }

    const version = record.version + 1;

    this.jobs.set(jobId, { ...record, data, version });

    if (isTerminal(next.status) && this.activeJobId === jobId) {
      this.activeJobId = undefined;
    }

    return { outcome: 'updated', version };
  }

  /** Test hook: stores raw text as a job record, as a corrupted Redis value would be. */
  putRawJob(jobId: string, data: string): void {
    this.jobs.set(jobId, { createdAtMs: this.clock.now().getTime(), data, version: 1 });
  }

  private read(jobId: string): StoredJob | undefined {
    const record = this.jobs.get(jobId);

    return record === undefined ? undefined : this.toStored(jobId, record);
  }

  private toStored(jobId: string, record: StoredRecord): StoredJob {
    return { job: decodeJob(record.data, jobId), version: record.version };
  }
}
