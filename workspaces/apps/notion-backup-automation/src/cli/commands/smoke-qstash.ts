import * as ui from '@workspaces/cli-output';

import { keyPrefixFor } from '../../adapters/persistence/keys.js';
import { RedisHealthStore } from '../../adapters/persistence/redis-health-store.js';
import { QStashScheduler, workerPath } from '../../adapters/qstash/qstash-scheduler.js';
import { loadEnv, qstashSmokeEnvSchema } from '../../config/env.js';
import { PING_JOB_ID } from '../../domain/naming.js';
import { randomIds } from '../../shared/ids.js';
import { systemSleep } from '../../shared/sleep.js';
import type { CliContext } from '../context.js';
import { createQStashApi } from '../context.js';

/** QStash delivers within seconds; flow control may queue the ping behind a running tick. */
const WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 2000;

/**
 * `smoke:qstash`: publishes a signed `_ping` through QStash (EU) to the deployed worker at
 * `APP_BASE_URL`, then waits for the worker to record its nonce in Redis for `APP_ENV`. Only a
 * delivery whose signature the worker verified can write it.
 */
export async function runSmokeQStash(context: CliContext): Promise<number> {
  const env = loadEnv(qstashSmokeEnvSchema, context.env);
  const health = new RedisHealthStore(
    context.createRedis({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL }),
    keyPrefixFor(env.APP_ENV),
  );
  const scheduler = new QStashScheduler({
    api: createQStashApi(context, { baseUrl: env.QSTASH_URL, token: env.QSTASH_TOKEN }),
    appBaseUrl: env.APP_BASE_URL,
    appEnv: env.APP_ENV,
    logger: context.logger,
  });
  const sleep = context.sleep ?? systemSleep;
  const nonce = randomIds.token();
  const destination = new URL(workerPath(PING_JOB_ID), env.APP_BASE_URL).href;

  context.print(ui.heading(`QStash smoke test for APP_ENV ${env.APP_ENV}`));

  const started = context.clock.now().getTime();
  const { messageId } = await scheduler.ping(nonce);

  context.print(`  published  ${PING_JOB_ID} to ${destination} (message ${messageId})`);
  context.print(ui.muted(`Waiting up to ${WAIT_MS / 1000} s for the worker to record it…`));

  for (;;) {
    const { qstashPing } = await health.read();
    const elapsedMs = context.clock.now().getTime() - started;

    if (qstashPing?.nonce === nonce) {
      context.print(
        ui.ok(
          `ping delivered and verified after ${Math.round(elapsedMs / 1000)} s (${qstashPing.receivedAt})`,
        ),
      );

      return 0;
    }

    if (elapsedMs >= WAIT_MS) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  context.print(ui.fail(`No verified delivery within ${WAIT_MS / 1000} s.`));
  context.print(
    ui.muted(
      'Check the message in the QStash console: 401 means the signing keys or APP_BASE_URL differ from the deployment; 503 means its configuration is incomplete; 404 means APP_BASE_URL is wrong.',
    ),
  );

  return 1;
}
