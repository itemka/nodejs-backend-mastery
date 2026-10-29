import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { main } from '../../src/cli/main.js';
import { seedJob, supervisedJob } from '../support/agent.js';
import { testCli } from '../support/cli-context.js';
import { FakeDrive, ROOT_ID } from '../support/fake-drive.js';
import { fakeCredentials } from '../support/fake-google.js';
import { minutesAfter } from '../support/jobs.js';
import { ManualClock } from '../support/manual-clock.js';
import { tempFile } from '../support/temp-file.js';

const env = {
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  APP_ENV: 'dev',
  GOOGLE_CLIENT_ID: fakeCredentials.clientId,
  GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
  GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: ROOT_ID,
  GOOGLE_REFRESH_TOKEN: fakeCredentials.refreshToken,
  NOTION_WORKSPACE_NAME: 'Example Workspace',
  NOTION_WORKSPACE_URL: 'https://app.notion.com/p/Dashboard-0123456789abcdef0123456789abcdef',
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-token',
  UPSTASH_REDIS_REST_URL: 'https://fake-redis.example',
};

async function setup(drive = new FakeDrive(), overrides: Record<string, string> = {}) {
  drive.add({ name: '2026' });

  return testCli({ env: { ...env, ...overrides }, fetch: drive.fetch });
}

describe('dev:tick', () => {
  it('refuses to run unless APP_ENV=dev', async () => {
    const cli = await setup(new FakeDrive(), { APP_ENV: 'prod' });

    await expect(main(['dev:tick', '--start'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('dev:tick runs the dev job only: run it with APP_ENV=dev.');
    await expect(cli.jobs.list({ limit: 1 })).resolves.toEqual([]);
  });

  it('creates this month’s dev job once, and names the next command', async () => {
    const cli = await setup();

    await expect(main(['dev:tick', '--start'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ Created job 2026-10 (manual)');
    expect(cli.text()).toContain(
      'Next: APP_ENV=dev pnpm --filter notion-backup-automation cli dev:tick 2026-10',
    );

    await expect(main(['dev:tick', '--start'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ Job 2026-10 already exists: CREATED');
    await expect(cli.jobs.list({ limit: 10 })).resolves.toHaveLength(1);
  });

  it('runs one step per call and adopts a verified ZIP already in _dev, without opening Notion', async () => {
    const drive = new FakeDrive();
    const cli = await setup(drive);

    // A test upload of this month: the dev job finds it before any export.
    await main(['dev:upload', await tempFile(randomBytes(4000))], cli.context);
    await main(['dev:tick', '--start'], cli.context);

    await expect(main(['dev:tick', '2026-10'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ begin_trigger: CREATED → TRIGGERING_EXPORT');
    expect(cli.text()).toContain('  next step due   2026-10-18T10:00:00.000Z (now)');

    await expect(main(['dev:tick', '2026-10'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ trigger_export: TRIGGERING_EXPORT → COMPLETE');
    expect(cli.text()).toContain(
      '  backup          notion-workspace-2026-10-18.zip in _dev/2026, 4.0 KB',
    );

    await expect(main(['dev:tick', '2026-10'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ Job 2026-10 is COMPLETE; nothing to do.');
  });

  it('shows the fix when the job needs you, then retries or cancels it', async () => {
    const cli = await setup();

    await main(['dev:tick', '--start'], cli.context);
    await main(['dev:tick', '2026-10'], cli.context);

    // No Notion session is saved for dev, so the trigger stops before any browser starts.
    await expect(main(['dev:tick', '2026-10'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('✓ trigger_export: TRIGGERING_EXPORT → NEEDS_ATTENTION');
    expect(cli.text()).toContain(
      '  error           NOTION_SESSION_EXPIRED: The saved Notion session is no longer signed in.',
    );
    expect(cli.text()).toContain(
      '  fix             Run auth:notion; it resumes the job (or run backup_retry).',
    );

    await expect(main(['dev:tick', '2026-10'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('Nothing is scheduled: job 2026-10 waits for you.');

    await expect(main(['dev:tick', '2026-10', '--retry'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ Job 2026-10 resumes from TRIGGERING_EXPORT');

    await expect(main(['dev:tick', '2026-10', '--cancel'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ Job 2026-10: cancelled');

    await expect(main(['dev:tick', '--start', '--force'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('✓ Created job 2026-10-r2 (forced)');
  });

  it('shows the supervisor’s decision and its summary', async () => {
    // The seeded incident opened 3 minutes after T0.
    const cli = await testCli({
      clock: new ManualClock(minutesAfter(5)),
      env: { ...env, AGENT_MODEL_PROVIDER: 'none' },
    });

    await seedJob({ memory: cli.jobs }, supervisedJob('NOTION_UNAVAILABLE'));

    await expect(main(['dev:tick', '2026-10'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('Supervisor: none');
    expect(cli.text()).toContain('  supervisor      decision 1: notify_user → handed_over');
    expect(cli.text()).toContain(
      '  summary         No supervisor model is configured (AGENT_MODEL_PROVIDER=none), so this incident was not triaged.',
    );
  });

  it('refuses a forced job while one is active, naming it', async () => {
    const cli = await setup();

    await main(['dev:tick', '--start'], cli.context);

    await expect(main(['dev:tick', '--start', '--force'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain(
      'ACTIVE_JOB_EXISTS: Job 2026-10 is still active; cancel it or wait for it to end',
    );
  });

  it('names a job that does not exist', async () => {
    const cli = await setup();

    await expect(main(['dev:tick', '2026-09'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain(
      'No job 2026-09 for APP_ENV dev. Create one with dev:tick --start.',
    );
  });

  it.each([
    [[]],
    [['2026-10', '--force']],
    [['--start', '2026-10']],
    [['--start', '--retry']],
    [['2026-10', '--retry', '--cancel']],
    [['not-a-job']],
  ])('refuses the arguments %j', async (args) => {
    const cli = await setup();

    await expect(main(['dev:tick', ...args], cli.context)).resolves.toBe(2);
  });
});
