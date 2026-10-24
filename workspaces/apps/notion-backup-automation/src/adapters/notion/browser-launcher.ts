import type { Browser, BrowserContext } from 'playwright-core';

import { IntegrationError } from '../../application/integration-error.js';
import type { NotionSession } from './notion-session.js';

/** The window `auth:notion` opens; later contexts replay the viewport it recorded (S2). */
export const SIGN_IN_VIEWPORT = { height: 900, width: 1440 } as const;

export interface LaunchOptions {
  readonly headless: boolean;
}

/**
 * Starts the browser for the Notion steps. Every launch has a new temporary profile, which
 * closing the browser deletes; it is never your own browser profile.
 */
export interface BrowserLauncher {
  launch(options: LaunchOptions): Promise<Browser>;
}

/**
 * Local runs: your installed Google Chrome, or else Playwright's Chromium once it is installed
 * with `pnpm --filter notion-backup-automation exec playwright-core install chromium`. The
 * serverless launcher (`@sparticuz/chromium`) follows with the worker (Step 21).
 */
export class LocalBrowserLauncher implements BrowserLauncher {
  async launch({ headless }: LaunchOptions): Promise<Browser> {
    // Loaded on first use, so code that never opens a browser never loads Playwright.
    const { chromium } = await import('playwright-core');

    try {
      return await chromium.launch({ channel: 'chrome', headless });
    } catch {
      try {
        return await chromium.launch({ headless });
      } catch {
        throw new IntegrationError(
          'BROWSER_LAUNCH_FAILED',
          'Neither Google Chrome nor Playwright Chromium started. Install Chrome, or run pnpm --filter notion-backup-automation exec playwright-core install chromium',
        );
      }
    }
  }
}

/**
 * A context with the saved session and the identity it was captured with. Downloads are
 * refused, so the browser never writes an export ZIP to disk.
 */
export function newSessionContext(
  browser: Browser,
  session: Pick<NotionSession, 'fingerprint' | 'storageState'>,
): Promise<BrowserContext> {
  const { locale, timezoneId, userAgent, viewport } = session.fingerprint;

  return browser.newContext({
    acceptDownloads: false,
    locale,
    storageState: session.storageState,
    timezoneId,
    userAgent,
    viewport,
  });
}

/**
 * Closes the browser, which also deletes its temporary profile. A failed close is ignored: the
 * result is already known, and the process exit ends the browser anyway.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // See above.
  }
}
