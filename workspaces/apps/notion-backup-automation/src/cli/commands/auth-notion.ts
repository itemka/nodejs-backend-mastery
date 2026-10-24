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
import { notionBrowserEnvSchema, loadEnv } from '../../config/env.js';
import type { CliContext } from '../context.js';
import { createNotionSessions } from '../context.js';

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
    exportFormat: env.NOTION_EXPORT_FORMAT,
    launcher: context.browserLauncher,
    logger: context.logger,
    sessions,
    workspace,
  });
  const probe = await trigger.probeSession();

  context.print(ui.ok(`authenticated, sign-in until ${probe.authCookieExpiresAt ?? 'unknown'}`));

  return 0;
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
