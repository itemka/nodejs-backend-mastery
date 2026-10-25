import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { onTestFinished } from 'vitest';

import { InMemoryJobRepository } from '../../src/adapters/persistence/in-memory-job-repository.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import type { CliContext, CliRedis } from '../../src/cli/context.js';
import { createLogger } from '../../src/shared/logger.js';
import { FakeRedis } from './fake-redis.js';
import { ManualClock } from './manual-clock.js';

export interface TestCli {
  context: CliContext;
  /** This test's own temp directory: `.env.local`, and `dev:download`'s temporary copy. */
  directory: string;
  /** The job repository `dev:tick` gets, shared by the calls of one test. */
  jobs: InMemoryJobRepository;
  /** JSON log lines. */
  logs: string[];
  /** Printed lines without colors. */
  output: string[];
  redis: FakeRedis;
  /** The whole printed output. */
  text: () => string;
}

/**
 * A CLI context with no network, browser or real files, writing `.env.local` to a temp dir. The
 * browser launcher fails like a machine without Chrome.
 */
export async function testCli(
  overrides: Partial<Omit<CliContext, 'env'>> & { env?: Record<string, string> } = {},
): Promise<TestCli> {
  const directory = await mkdtemp(path.join(tmpdir(), 'nba-cli-'));

  onTestFinished(() => rm(directory, { force: true, recursive: true }));

  const output: string[] = [];
  const logs: string[] = [];
  const redis = new FakeRedis();
  const clock = overrides.clock ?? new ManualClock('2026-10-18T10:00:00.000Z');
  const jobs = new InMemoryJobRepository(clock);
  const context: CliContext = {
    browserLauncher: {
      launch: () =>
        Promise.reject(new IntegrationError('BROWSER_LAUNCH_FAILED', 'No browser in tests')),
    },
    clock,
    createJobRepository: () => jobs,
    createRedis: (): CliRedis => redis,
    envFilePath: path.join(directory, '.env.local'),
    logger: createLogger({
      level: 'debug',
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    openBrowser: () => Promise.resolve(),
    print: (text) => {
      output.push(stripVTControlCharacters(text));
    },
    tempDirectory: directory,
    ...overrides,
    env: overrides.env ?? {},
  };

  return { context, directory, jobs, logs, output, redis, text: () => output.join('\n') };
}
