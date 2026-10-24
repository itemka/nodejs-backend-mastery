import * as ui from '@workspaces/cli-output';

import { keyPrefixFor } from '../../adapters/persistence/keys.js';
import {
  describeShrink,
  describeSize,
  formatDuration,
} from '../../application/notification-text.js';
import type { Scheduler } from '../../application/ports.js';
import type { TickResult } from '../../application/process-job.js';
import type { BackupServices } from '../../config/containers.js';
import { createBackupServices } from '../../config/containers.js';
import { backupEnvSchema, loadEnv } from '../../config/env.js';
import { errorCatalog } from '../../domain/error-catalog.js';
import type { BackupJob } from '../../domain/job.js';
import { DEV_FOLDER_NAME, yearFolderName } from '../../domain/naming.js';
import { isTerminal } from '../../domain/statuses.js';
import type { DevTickRequest } from '../args.js';
import type { CliContext } from '../context.js';
import { fetchOption } from '../context.js';

const COMMAND = 'APP_ENV=dev pnpm --filter notion-backup-automation cli dev:tick';

/** Publishes nothing: `dev:tick` prints when the next step is due, and you run it. */
class PrintedScheduler implements Scheduler {
  cancel(): Promise<void> {
    return Promise.resolve();
  }

  schedule(): Promise<{ messageId?: string }> {
    return Promise.resolve({});
  }
}

/**
 * `dev:tick`: the whole backup run locally, one tick per call, with the code the worker runs.
 * It runs only with `APP_ENV=dev`: the dev Redis prefix, the dev Notion session, and
 * `_dev/<YYYY>/` in Drive. Nothing goes to QStash.
 */
export async function runDevTick(request: DevTickRequest, context: CliContext): Promise<number> {
  const env = loadEnv(backupEnvSchema, context.env);

  if (env.APP_ENV !== 'dev') {
    context.print(ui.fail('dev:tick runs the dev job only: run it with APP_ENV=dev.'));

    return 1;
  }

  const connection = { token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL };
  const services = createBackupServices(env, {
    browserLauncher: context.browserLauncher,
    clock: context.clock,
    jobs: context.createJobRepository(connection, keyPrefixFor(env.APP_ENV)),
    logger: context.logger,
    redis: context.createRedis(connection),
    scheduler: new PrintedScheduler(),
    ...fetchOption(context),
  });

  context.print(ui.heading('Dev tick'));

  switch (request.mode) {
    case 'cancel': {
      const { job } = await services.service.cancel(request.jobId, 'dev:tick --cancel');

      context.print(
        ui.ok(`Job ${job.id}: ${job.status === 'CANCELLED' ? 'cancelled' : 'cancel requested'}`),
      );
      printJob(job, context);

      return 0;
    }

    case 'retry': {
      const { job } = await services.service.retry(request.jobId);

      context.print(ui.ok(`Job ${job.id} resumes from ${job.status}`));
      printNext(job, context);

      return 0;
    }

    case 'start': {
      const { created, job } = await services.service.start({
        force: request.force,
        reason: 'dev:tick',
      });

      context.print(
        created
          ? ui.ok(`Created job ${job.id} (${job.kind})`)
          : ui.ok(`Job ${job.id} already exists: ${job.status}`),
      );
      printJob(job, context);
      printNext(job, context);

      return 0;
    }

    case 'tick': {
      return tick(services, request.jobId, context);
    }
  }
}

async function tick(services: BackupServices, jobId: string, context: CliContext): Promise<number> {
  const stored = await services.jobs.get(jobId);

  if (stored === undefined) {
    context.print(ui.fail(`No job ${jobId} for APP_ENV dev. Create one with dev:tick --start.`));

    return 1;
  }

  const before = stored.job;

  if (isTerminal(before.status)) {
    context.print(ui.ok(`Job ${jobId} is ${before.status}; nothing to do.`));
    printJob(before, context);

    return 0;
  }

  if (before.schedule === undefined) {
    context.print(ui.warn(`Nothing is scheduled: job ${jobId} waits for you.`));
    printJob(before, context);

    return 1;
  }

  const result = await services.processJob.execute({
    jobId,
    reason: 'manual',
    token: before.schedule.token,
  });
  const reloaded = await services.jobs.get(jobId);
  const after = reloaded?.job ?? before;

  context.print(describeTick(result, before, after));
  printJob(after, context);
  printNext(after, context);

  return after.status === 'NEEDS_ATTENTION' || after.status === 'FAILED' ? 1 : 0;
}

function describeTick(result: TickResult, before: BackupJob, after: BackupJob): string {
  switch (result.outcome) {
    case 'done': {
      return before.status === after.status
        ? ui.ok(`${result.step}: still ${after.status}`)
        : ui.ok(`${result.step}: ${before.status} → ${after.status}`);
    }

    case 'lease_held': {
      return ui.warn(`Another worker holds the job; try again in ${result.retryAfterSec} s.`);
    }

    default: {
      // not_found, stale or terminal.
      return ui.muted(`Nothing ran (${result.outcome}).`);
    }
  }
}

function printJob(job: BackupJob, context: CliContext): void {
  const now = context.clock.now().getTime();

  context.print(`  status          ${job.status}`);
  context.print(`  export attempt  ${job.exportAttempt}`);

  if (job.status === 'WAITING_FOR_EMAIL') {
    context.print(`  email checks    ${job.emailCheckAttempt}`);
  }

  if (job.schedule !== undefined && !isTerminal(job.status)) {
    const waitMs = Date.parse(job.schedule.notBefore) - now;

    context.print(
      `  next step due   ${job.schedule.notBefore}${waitMs > 0 ? ` (in ${formatDuration(waitMs)})` : ' (now)'}`,
    );
  }

  if (job.lastError !== undefined && !['CANCELLED', 'COMPLETE'].includes(job.status)) {
    const { code } = job.lastError;

    context.print(`  error           ${code}: ${errorCatalog[code].description}`);
    context.print(`  fix             ${errorCatalog[code].howToFix}`);
    context.print(ui.muted(`  in dev, retry with: ${COMMAND} ${job.id} --retry`));
  }

  if (job.result !== undefined) {
    const folder = `${DEV_FOLDER_NAME}/${yearFolderName(job.period)}`;

    context.print(
      `  backup          ${job.result.fileName} in ${folder}, ${describeSize(job.result)}`,
    );
    context.print(`  Drive file      ${job.result.driveFileId}`);

    const shrink = describeShrink(job.result);

    if (shrink !== undefined) {
      context.print(ui.warn(`  much smaller than the last backup: ${shrink}`));
    }
  }
}

function printNext(job: BackupJob, context: CliContext): void {
  if (!isTerminal(job.status) && job.schedule !== undefined) {
    context.print(`Next: ${COMMAND} ${job.id}`);
  }
}
