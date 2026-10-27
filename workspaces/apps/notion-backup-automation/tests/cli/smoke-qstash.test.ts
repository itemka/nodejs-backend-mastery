import { describe, expect, it } from 'vitest';

import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisHealthStore } from '../../src/adapters/persistence/redis-health-store.js';
import { QStashSignatureVerifier } from '../../src/adapters/qstash/qstash-signature-verifier.js';
import { main } from '../../src/cli/main.js';
import { handleWorkerRequest } from '../../src/http/worker-handler.js';
import { createLogger } from '../../src/shared/logger.js';
import { testCli } from '../support/cli-context.js';
import { ManualClock } from '../support/manual-clock.js';
import {
  FakeQStashApi,
  signedDelivery,
  TEST_BASE_URL,
  TEST_SIGNING_KEYS,
} from '../support/qstash.js';

const env = {
  APP_BASE_URL: TEST_BASE_URL,
  APP_ENV: 'prod',
  QSTASH_TOKEN: 'fake-qstash-token',
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
  UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
};

/**
 * The CLI against a fake QStash that delivers each publish, signed with `signingKey`, to the
 * real worker handler on the CLI's Redis. The wait between checks moves the clock.
 */
async function setup(signingKey?: string) {
  const clock = new ManualClock('2026-10-26T10:00:00.000Z');
  const qstash = new FakeQStashApi();
  const cli = await testCli({
    clock,
    env,
    qstash,
    sleep: (ms) => {
      clock.advance(ms);

      return Promise.resolve();
    },
  });
  const responses: number[] = [];

  qstash.onPublish = async (request) => {
    if (signingKey === undefined) {
      return;
    }

    const path = new URL(request.url).pathname;
    const response = await handleWorkerRequest(
      signedDelivery(path, request.body, { key: signingKey }),
      {
        appBaseUrl: TEST_BASE_URL,
        clock,
        health: new RedisHealthStore(cli.redis, keyPrefixFor('prod')),
        logger: createLogger({
          sink: () => {
            // The worker's logs are not under test here.
          },
        }),
        processJob: () => {
          throw new Error('A ping never runs a tick');
        },
        verifier: new QStashSignatureVerifier(TEST_SIGNING_KEYS),
      },
    );

    responses.push(response.status);
  };

  return { cli, qstash, responses };
}

describe('smoke:qstash', () => {
  it('reports a signed _ping that the worker verified and recorded', async () => {
    const { cli, qstash, responses } = await setup(TEST_SIGNING_KEYS.current);

    await expect(main(['smoke:qstash'], cli.context)).resolves.toBe(0);

    expect(qstash.published).toHaveLength(1);
    expect(qstash.published[0]).toMatchObject({
      flowControl: { key: 'nba-prod', parallelism: 1 },
      url: `${TEST_BASE_URL}/api/jobs/process/_ping`,
    });
    expect(responses).toEqual([200]);
    expect(cli.text()).toContain(
      `published  _ping to ${TEST_BASE_URL}/api/jobs/process/_ping (message msg_1)`,
    );
    expect(cli.text()).toContain('✓ ping delivered and verified after 0 s');
  });

  it('fails after two minutes when the worker refuses the signature', async () => {
    const { cli, responses } = await setup('sig_unknown_0123456789abcdefghijkl');

    await expect(main(['smoke:qstash'], cli.context)).resolves.toBe(1);

    expect(responses).toEqual([401]);
    expect(cli.text()).toContain('No verified delivery within 120 s.');
    expect(cli.text()).toContain('401 means the signing keys or APP_BASE_URL differ');
  });

  it('fails when nothing arrives, and names a failed publish without its content', async () => {
    const { cli, qstash } = await setup();

    await expect(main(['smoke:qstash'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('No verified delivery within 120 s.');

    qstash.failures = 1;
    await expect(main(['smoke:qstash'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('SCHEDULER_UNAVAILABLE: QStash publish failed');
    expect(cli.text()).not.toContain('eyJsecret');
  });

  it('names the missing configuration', async () => {
    const cli = await testCli({ env: { APP_ENV: 'prod' } });

    await expect(main(['smoke:qstash'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain(
      'Configuration incomplete: missing APP_BASE_URL, QSTASH_TOKEN, UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL',
    );
  });
});
