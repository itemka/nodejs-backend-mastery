import type { Redis } from '@upstash/redis';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

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
import {
  assertCreatable,
  assertSameJob,
  decodeEvents,
  decodeJob,
  encodeEvent,
  encodeJob,
  StateSchemaInvalidError,
} from './job-codec.js';
import type { PersistenceKeys } from './keys.js';
import { persistenceKeys } from './keys.js';

// Literal paths, so Vercel's file tracing can find the scripts next to the compiled module.
const appendEventScript = readFileSync(new URL('lua/append-event.lua', import.meta.url), 'utf8');
const claimEmailScript = readFileSync(new URL('lua/claim-email.lua', import.meta.url), 'utf8');
const createJobScript = readFileSync(new URL('lua/create-job.lua', import.meta.url), 'utf8');
const releaseLeaseScript = readFileSync(new URL('lua/release-lease.lua', import.meta.url), 'utf8');
const updateJobScript = readFileSync(new URL('lua/update-job.lua', import.meta.url), 'utf8');

const createReplySchema = z.union([
  z.tuple([z.literal('created'), z.string()]),
  z.tuple([z.literal('exists'), z.string(), z.string()]),
  z.tuple([z.literal('active_exists'), z.string()]),
]);

const updateReplySchema = z.union([
  z.tuple([z.literal('updated'), z.string()]),
  z.tuple([z.literal('conflict'), z.string()]),
  z.tuple([z.literal('not_found')]),
]);

/**
 * The raw `HMGET v data` reply. With automatic deserialization off, the client returns Redis
 * replies as they are, so this is an array, whatever the client's typings say.
 */
const storedHashSchema = z.union([
  z.tuple([z.string().regex(/^\d+$/), z.string()]),
  z.tuple([z.null(), z.null()]),
]);

/** Redis replies are checked too: a shape the code does not expect is never guessed at. */
function parseReply<T>(schema: z.ZodType<T>, reply: unknown, jobId: string): T {
  const parsed = schema.safeParse(reply);

  if (!parsed.success) {
    throw new StateSchemaInvalidError('job', jobId);
  }

  return parsed.data;
}

function toStored(jobId: string, version: string, data: string): StoredJob {
  return { job: decodeJob(data, jobId), version: Number(version) };
}

/**
 * `JobRepository` on Upstash Redis: Lua scripts for every multi-step write (create, compare-and-set,
 * lease release, event append, email claim) and `SET NX PX` leases.
 */
export class RedisJobRepository implements JobRepository {
  private readonly keys: PersistenceKeys;
  private readonly redis: Redis;
  private readonly scripts;

  constructor(redis: Redis, keyPrefix: string) {
    this.redis = redis;
    this.keys = persistenceKeys(keyPrefix);
    this.scripts = {
      appendEvent: redis.createScript<unknown>(appendEventScript),
      claimEmail: redis.createScript<unknown>(claimEmailScript),
      createJob: redis.createScript<unknown>(createJobScript),
      releaseLease: redis.createScript<unknown>(releaseLeaseScript),
      updateJob: redis.createScript<unknown>(updateJobScript),
    };
  }

  async acquireLease(jobId: string, workerId: string, ttlMs: number): Promise<LeaseResult> {
    const key = this.keys.lease(jobId);
    const reply = await this.redis.set(key, workerId, { nx: true, px: ttlMs });

    if (reply === 'OK') {
      return { acquired: true };
    }

    const remainingMs = await this.redis.pttl(key);

    return { acquired: false, remainingMs: Math.max(remainingMs, 0) };
  }

  async appendEvent(jobId: string, event: JobEvent): Promise<void> {
    await this.scripts.appendEvent.exec(
      [this.keys.events(jobId)],
      [encodeEvent(event, jobId), String(MAX_JOB_EVENTS)],
    );
  }

  async create(job: BackupJob): Promise<CreateJobResult> {
    assertCreatable(job);

    const reply = parseReply(
      createReplySchema,
      await this.scripts.createJob.exec(
        [this.keys.job(job.id), this.keys.jobs, this.keys.active],
        [job.id, encodeJob(job), String(Date.parse(job.createdAt))],
      ),
      job.id,
    );

    switch (reply[0]) {
      case 'active_exists': {
        return { activeJobId: reply[1], outcome: 'active_exists' };
      }

      case 'created': {
        return { outcome: 'created', stored: { job, version: Number(reply[1]) } };
      }

      case 'exists': {
        return { outcome: 'exists', stored: toStored(job.id, reply[1], reply[2]) };
      }
    }
  }

  async findActive(): Promise<StoredJob | undefined> {
    const jobId = await this.redis.get<string>(this.keys.active);

    return jobId === null ? undefined : this.get(jobId);
  }

  async get(jobId: string): Promise<StoredJob | undefined> {
    const hash = await this.redis.hmget(this.keys.job(jobId), 'v', 'data');

    return this.fromHash(jobId, hash);
  }

  async list({ limit }: { limit: number }): Promise<StoredJob[]> {
    // ZRANGE 0 -1 would return the whole set for a limit of 0.
    if (limit <= 0) {
      return [];
    }

    const ids = await this.redis.zrange<string[]>(this.keys.jobs, 0, limit - 1, { rev: true });

    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();

    for (const id of ids) {
      pipeline.hmget(this.keys.job(id), 'v', 'data');
    }

    const hashes = await pipeline.exec<unknown[]>();

    return ids.flatMap((id, index) => {
      const stored = this.fromHash(id, hashes[index]);

      return stored === undefined ? [] : [stored];
    });
  }

  async listEvents(jobId: string, { limit }: { limit: number }): Promise<JobEvent[]> {
    // LRANGE -0 -1 would return the whole list for a limit of 0.
    if (limit <= 0) {
      return [];
    }

    const entries = await this.redis.lrange(this.keys.events(jobId), -limit, -1);

    return decodeEvents(entries);
  }

  async markEmailConsumed(messageId: string, jobId: string): Promise<{ ownerJobId: string }> {
    const ownerJobId = parseReply(
      z.string().min(1),
      await this.scripts.claimEmail.exec([this.keys.email(messageId)], [jobId]),
      jobId,
    );

    return { ownerJobId };
  }

  async releaseLease(jobId: string, workerId: string): Promise<boolean> {
    const released = await this.scripts.releaseLease.exec([this.keys.lease(jobId)], [workerId]);

    return released === 1;
  }

  async update(jobId: string, expectedVersion: number, next: BackupJob): Promise<UpdateJobResult> {
    assertSameJob(jobId, next);

    const reply = parseReply(
      updateReplySchema,
      await this.scripts.updateJob.exec(
        [this.keys.job(jobId), this.keys.active],
        [jobId, String(expectedVersion), encodeJob(next), isTerminal(next.status) ? '1' : '0'],
      ),
      jobId,
    );

    switch (reply[0]) {
      case 'conflict': {
        return { outcome: 'conflict', version: Number(reply[1]) };
      }

      case 'not_found': {
        return { outcome: 'not_found' };
      }

      case 'updated': {
        return { outcome: 'updated', version: Number(reply[1]) };
      }
    }
  }

  private fromHash(jobId: string, reply: unknown): StoredJob | undefined {
    const [version, data] = parseReply(storedHashSchema, reply, jobId);

    return version === null || data === null ? undefined : toStored(jobId, version, data);
  }
}
