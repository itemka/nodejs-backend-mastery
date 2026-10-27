import * as ui from '@workspaces/cli-output';

import { closeBrowser, SIGN_IN_VIEWPORT } from '../../adapters/notion/browser-launcher.js';
import { PlaywrightNotionExportTrigger } from '../../adapters/notion/notion-export-trigger.js';
import type { CapturedSession } from '../../adapters/notion/notion-session.js';
import { captureSession, FILE_HOST_COOKIE } from '../../adapters/notion/notion-session.js';
import {
  NOTION_LOGIN_URL,
  passSessionGate,
  waitForSignIn,
} from '../../adapters/notion/session-gate.js';
import { keyPrefixFor } from '../../adapters/persistence/keys.js';
import { QStashScheduler, SchedulerError } from '../../adapters/qstash/qstash-scheduler.js';
import { ApplicationError } from '../../application/application-error.js';
import { BackupApplicationService } from '../../application/backup-service.js';
import { awaitedLogin, resumeAfterLoginFix } from '../../application/login-watch.js';
import type { Scheduler } from '../../application/ports.js';
import { policyFrom } from '../../config/containers.js';
import { loadEnv, loginResumeEnvSchema, notionBrowserEnvSchema } from '../../config/env.js';
import { randomIds } from '../../shared/ids.js';
import type { CliContext } from '../context.js';
import { createNotionSessions, createQStashApi, noPublishScheduler } from '../context.js';

const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const GATE_TIMEOUT_MS = 60_000;

/** Runs in the page; reads the identity that later contexts replay (S2). */
const readFingerprint = `({
  locale: navigator.language,
  timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  userAgent: navigator.userAgent,
  viewport: { height: window.innerHeight, width: window.innerWidth },
})`;

/**
 * `auth:notion`: you sign in to Notion in a visible Chrome window with a fresh, temporary
 * profile; nothing is typed for you. The session (Notion's cookies and localStorage only) is
 * encrypted into Redis for `APP_ENV`, never written to disk, then checked again in a new
 * headless browser by the worker's session gate. A session without the file host's cookie is
 * not saved, so the one saved before stays. Output names cookies' facts, never values.
 */
export async function runAuthNotion(context: CliContext): Promise<number> {
  const env = loadEnv(notionBrowserEnvSchema, context.env);
  const sessions = createNotionSessions(context, env);
  const workspace = { name: env.NOTION_WORKSPACE_NAME, url: env.NOTION_WORKSPACE_URL };

  context.print(ui.heading(`Notion sign-in for APP_ENV ${env.APP_ENV}`));

  const captured = await signInAndCapture(context, workspace);

  context.print(
    `  captured       ${captured.storageState.cookies.length} Notion cookies, localStorage of ${captured.storageState.origins.length} origins`,
  );
  context.print(
    `  sign-in until  ${captured.authCookieExpiresAt ?? 'the end of a browser session'}`,
  );

  // Checked before the save, so a sign-in the download cannot use keeps the session saved before.
  if (!captured.fileHostCookie) {
    context.print(
      ui.fail(
        `No ${FILE_HOST_COOKIE} cookie matches file.notion.com, so the export download would fail with NOTION_SESSION_EXPIRED. Nothing was saved.`,
      ),
    );

    return 1;
  }

  context.print(`  file host      ${FILE_HOST_COOKIE} matches file.notion.com`);
  await sessions.save(captured);
  context.print(
    ui.ok(
      `Saved the encrypted session to Redis as {nba:${env.APP_ENV}}:secret:notion-storage-state`,
    ),
  );

  context.print(ui.muted('Checking the saved session in a new headless browser…'));

  const trigger = new PlaywrightNotionExportTrigger({
    clock: context.clock,
    exportFormat: env.NOTION_EXPORT_FORMAT,
    launcher: context.browserLauncher,
    logger: context.logger,
    sessions,
    workspace,
  });
  const probe = await trigger.probeSession();

  context.print(ui.ok(`authenticated, sign-in until ${probe.authCookieExpiresAt ?? 'unknown'}`));
  await resumeWaitingJob(context);

  return 0;
}

/**
 * `resumeAfterLoginFix('notion')`: a job that waits for the Notion login is retried, as
 * `backup_retry` would. A dev job publishes nothing (`dev:tick` runs it); any other needs
 * `QSTASH_TOKEN` and `APP_BASE_URL` to queue its wakeup, or the command names `backup_retry`.
 * A refusal is reported, but the saved session stands.
 */
async function resumeWaitingJob(context: CliContext): Promise<void> {
  const env = loadEnv(loginResumeEnvSchema, context.env);
  const jobs = context.createJobRepository(
    { token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL },
    keyPrefixFor(env.APP_ENV),
  );
  const active = await jobs.findActive();

  if (active === undefined || awaitedLogin(active.job) !== 'notion') {
    return;
  }

  const jobId = active.job.id;
  let scheduler: Scheduler;

  if (env.APP_ENV === 'dev') {
    scheduler = noPublishScheduler;
  } else if (env.QSTASH_TOKEN === undefined || env.APP_BASE_URL === undefined) {
    context.print(
      ui.warn(
        `Job ${jobId} waits for the Notion login. QSTASH_TOKEN or APP_BASE_URL is not set here, so resume it with backup_retry.`,
      ),
    );

    return;
  } else {
    scheduler = new QStashScheduler({
      api: createQStashApi(context, { baseUrl: env.QSTASH_URL, token: env.QSTASH_TOKEN }),
      appBaseUrl: env.APP_BASE_URL,
      appEnv: env.APP_ENV,
      logger: context.logger,
    });
  }

  const service = new BackupApplicationService({
    clock: context.clock,
    ids: randomIds,
    jobs,
    logger: context.logger,
    policy: policyFrom(env),
    scheduler,
    timeZone: env.BACKUP_TIME_ZONE,
  });

  try {
    const job = await resumeAfterLoginFix(
      { job: active.job, logger: context.logger, service },
      'notion',
    );

    if (job !== undefined) {
      context.print(ui.ok(`Job ${job.id} resumes from ${job.status}`));

      if (env.APP_ENV === 'dev') {
        context.print(
          `Next: APP_ENV=dev pnpm --filter notion-backup-automation cli dev:tick ${job.id}`,
        );
      }
    }
  } catch (error) {
    if (!(error instanceof ApplicationError || error instanceof SchedulerError)) {
      throw error;
    }

    context.print(
      ui.warn(`Job ${jobId} was not resumed (${error.code}: ${error.message}); run backup_retry.`),
    );
  }
}

/** The headed sign-in: the login page, your sign-in, the session gate, then the capture. */
async function signInAndCapture(
  context: CliContext,
  workspace: { name: string; url: string },
): Promise<CapturedSession> {
  const browser = await context.browserLauncher.launch({ headless: false });

  try {
    const browserContext = await browser.newContext({
      acceptDownloads: false,
      viewport: SIGN_IN_VIEWPORT,
    });
    const page = await browserContext.newPage();

    await page.goto(NOTION_LOGIN_URL);
    context.print(
      'Sign in to Notion in the Chrome window yourself, including MFA. If Google sign-in refuses the window, use "Continue with email". Waiting up to 10 minutes.',
    );
    await waitForSignIn(page, { timeoutMs: SIGN_IN_TIMEOUT_MS });
    await passSessionGate(page, {
      timeoutMs: GATE_TIMEOUT_MS,
      workspaceName: workspace.name,
      workspaceUrl: workspace.url,
    });

    const fingerprint = await page.evaluate<unknown>(readFingerprint);

    return captureSession(await browserContext.storageState(), fingerprint, context.clock.now());
  } finally {
    await closeBrowser(browser);
  }
}
