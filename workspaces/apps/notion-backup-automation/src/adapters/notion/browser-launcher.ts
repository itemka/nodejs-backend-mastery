import { readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  Browser,
  BrowserContext,
  LaunchOptions as PlaywrightLaunchOptions,
} from 'playwright-core';

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
 * with `pnpm --filter notion-backup-automation exec playwright-core install chromium`.
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

/** `@sparticuz/chromium` adds these; a browser holding the Notion session keeps web security on (S2). */
const INSECURE_FLAGS = new Set([
  '--allow-running-insecure-content',
  '--disable-site-isolation-trials',
  '--disable-web-security',
]);

/** Single-process Chromium sometimes dumps core on close: ~265 MB of memory, session included (S2). */
const CORE_DUMP = /^core(\.|$)/;

/** The parts of `@sparticuz/chromium` the launcher uses. */
export interface ServerlessChromium {
  readonly args: readonly string[];
  executablePath(): Promise<string>;
  setGraphicsMode: boolean;
}

export interface ServerlessBrowserLauncherOptions {
  /** `@sparticuz/chromium`, loaded on first use (tests replace it). */
  readonly loadChromium?: () => Promise<ServerlessChromium>;
  /** Playwright's `chromium.launch` (tests replace it). */
  readonly loadLaunch?: () => Promise<(options: PlaywrightLaunchOptions) => Promise<Browser>>;
  /** Where Chromium unpacks and dumps core: `/tmp` on Vercel. */
  readonly tmpDirectory?: string;
}

/**
 * Vercel: the `@sparticuz/chromium` headless shell, as S2 proved it. Headless, without graphics,
 * without the flags that turn off web security, and with `--single-process` (without it the
 * Notion app never renders). It starts through a `/bin/sh` wrapper with `ulimit -c 0`, and core
 * dumps in `/tmp` are deleted before the launch and when the browser closes.
 */
export class ServerlessBrowserLauncher implements BrowserLauncher {
  private readonly loadChromium: () => Promise<ServerlessChromium>;
  private readonly loadLaunch: () => Promise<
    (options: PlaywrightLaunchOptions) => Promise<Browser>
  >;
  private readonly tmpDirectory: string;

  constructor(options: ServerlessBrowserLauncherOptions = {}) {
    this.loadChromium = options.loadChromium ?? loadSparticuzChromium;
    this.loadLaunch = options.loadLaunch ?? loadPlaywrightLaunch;
    this.tmpDirectory = options.tmpDirectory ?? tmpdir();
  }

  async launch(): Promise<Browser> {
    let browser: Browser;

    try {
      const [chromium, launch] = await Promise.all([this.loadChromium(), this.loadLaunch()]);

      chromium.setGraphicsMode = false;
      await this.removeCoreDumps();

      const executablePath = await this.withoutCoreDumps(await chromium.executablePath());

      browser = await launch({
        args: chromium.args.filter((flag) => !INSECURE_FLAGS.has(flag)),
        executablePath,
        headless: true,
      });
    } catch {
      throw new IntegrationError('BROWSER_LAUNCH_FAILED', 'Serverless Chromium did not start');
    }

    browser.on('disconnected', () => {
      void this.removeCoreDumps();
    });

    return browser;
  }

  /** Best effort; a dump that stays is deleted before the next launch. */
  private async removeCoreDumps(): Promise<void> {
    try {
      const names = await readdir(this.tmpDirectory);

      await Promise.all(
        names
          .filter((name) => CORE_DUMP.test(name))
          .map((name) => rm(path.join(this.tmpDirectory, name), { force: true })),
      );
    } catch {
      // See above.
    }
  }

  /** A launcher script that runs Chromium with core dumps off. */
  private async withoutCoreDumps(executablePath: string): Promise<string> {
    const wrapper = path.join(this.tmpDirectory, 'chromium-no-core.sh');
    const quoted = executablePath.replaceAll("'", String.raw`'\''`);

    await writeFile(wrapper, `#!/bin/sh\nulimit -c 0\nexec '${quoted}' "$@"\n`, { mode: 0o700 });

    return wrapper;
  }
}

async function loadSparticuzChromium(): Promise<ServerlessChromium> {
  const { default: chromium } = await import('@sparticuz/chromium');

  return chromium;
}

async function loadPlaywrightLaunch(): Promise<
  (options: PlaywrightLaunchOptions) => Promise<Browser>
> {
  const { chromium } = await import('playwright-core');

  return (options) => chromium.launch(options);
}

/**
 * The serverless launcher on Vercel (`VERCEL=1`), your Chrome everywhere else. Neither loads a
 * browser package before its first launch.
 */
export function createBrowserLauncher(env: NodeJS.ProcessEnv = process.env): BrowserLauncher {
  return env.VERCEL === '1' ? new ServerlessBrowserLauncher() : new LocalBrowserLauncher();
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
