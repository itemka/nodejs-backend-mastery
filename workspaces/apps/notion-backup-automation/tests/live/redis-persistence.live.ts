import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { createRedisClient } from '../../src/adapters/persistence/redis-client.js';
import { RedisHealthStore } from '../../src/adapters/persistence/redis-health-store.js';
import { RedisJobRepository } from '../../src/adapters/persistence/redis-job-repository.js';
import { RedisNotificationGate } from '../../src/adapters/persistence/redis-notification-gate.js';
import { RedisSecretStore } from '../../src/adapters/persistence/redis-secret-store.js';
import { createEnvelopeKey } from '../../src/shared/envelope-crypto.js';
import { describeJobRepositoryContract } from '../contract/job-repository.contract.js';

/*
 * Opt-in: `NBA_LIVE_REDIS=1 pnpm --filter notion-backup-automation test:live`.
 * Runs the repository contract against real Redis under `{nba:test}:live-<run>:`, and deletes
 * every key of the run afterwards. The credentials come from `.env.local`. A local
 * serverless-redis-http emulator works too, which is why plain http is accepted here.
 */
const enabled = process.env.NBA_LIVE_REDIS === '1';
const envFile = path.resolve(import.meta.dirname, '../../.env.local');

if (enabled && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const connection = z
  .object({ UPSTASH_REDIS_REST_TOKEN: z.string().min(1), UPSTASH_REDIS_REST_URL: z.url() })
  .safeParse(process.env);

if (enabled && !connection.success) {
  throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local');
}

const redis = connection.success
  ? createRedisClient({
      token: connection.data.UPSTASH_REDIS_REST_TOKEN,
      url: connection.data.UPSTASH_REDIS_REST_URL,
    })
  : undefined;
const runPrefix = `${keyPrefixFor('test')}live-${randomBytes(4).toString('hex')}:`;
let caseNumber = 0;

function requireRedis() {
  if (redis === undefined) {
    throw new Error('Live Redis is not configured');
  }

  return redis;
}

/** Each case gets its own prefix inside the run, so cases never see each other's keys. */
function nextPrefix(): string {
  caseNumber += 1;

  return `${runPrefix}${caseNumber}:`;
}

describe.runIf(enabled)('live Redis', () => {
  afterAll(async () => {
    const client = requireRedis();
    let cursor = '0';
    let deleted = 0;

    do {
      const [next, keys] = await client.scan(cursor, { count: 500, match: `${runPrefix}*` });

      cursor = String(next);

      if (keys.length > 0) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== '0');

    const [, left] = await client.scan('0', { count: 500, match: `${runPrefix}*` });

    expect(left).toEqual([]);
    console.info(`live Redis: deleted ${deleted} test keys under ${runPrefix}`);
  });

  describeJobRepositoryContract('Upstash Redis', () => ({
    advance: async (ms) => {
      await sleep(ms);
    },
    repository: new RedisJobRepository(requireRedis(), nextPrefix()),
  }));

  it('reads a corrupted record as STATE_SCHEMA_INVALID', async () => {
    const client = requireRedis();
    const prefix = nextPrefix();

    await client.hset(`${prefix}job:2026-10`, { data: '{"schemaVersion":1}', v: '1' });

    await expect(new RedisJobRepository(client, prefix).get('2026-10')).rejects.toMatchObject({
      code: 'STATE_SCHEMA_INVALID',
    });
  });

  it('round-trips an encrypted secret', async () => {
    const store = new RedisSecretStore({
      appEnv: 'test',
      key: createEnvelopeKey(randomBytes(32).toString('base64')),
      keyPrefix: nextPrefix(),
      redis: requireRedis(),
    });

    await store.put('notion-storage-state', '{"cookies":[]}', { hasFileHostCookie: false });

    expect(await store.get('notion-storage-state')).toMatchObject({
      meta: { hasFileHostCookie: false },
      value: '{"cookies":[]}',
    });
  });

  it('round-trips a health field', async () => {
    const store = new RedisHealthStore(requireRedis(), nextPrefix());
    const qstashPing = { nonce: 'live-nonce-1234', receivedAt: new Date().toISOString() };

    await store.write('qstashPing', qstashPing);

    expect(await store.read()).toEqual({ qstashPing });
  });

  it('claims a notification once with SET NX EX, with the TTL asked for', async () => {
    const client = requireRedis();
    const prefix = nextPrefix();
    const gate = new RedisNotificationGate(client, prefix);

    await expect(gate.claim('lost:notion', 60)).resolves.toBe(true);
    await expect(gate.claim('lost:notion', 60)).resolves.toBe(false);
    await expect(gate.claim('lost:google', 60)).resolves.toBe(true);

    const ttl = await client.ttl(`${prefix}notify:lost:notion`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
