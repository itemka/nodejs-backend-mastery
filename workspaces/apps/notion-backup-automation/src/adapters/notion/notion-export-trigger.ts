import type { BrowserContext, Locator, Page } from 'playwright-core';

import { IntegrationError } from '../../application/integration-error.js';
import type {
  ExportRequest,
  ExportTriggerOutcome,
  NotionExportTrigger,
  NotionProbeResult,
  SessionProbe,
} from '../../application/ports.js';
import type { NotionExportFormat } from '../../config/env.js';
import { abortable } from '../../shared/abortable.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import type { Logger } from '../../shared/logger.js';
import type { BrowserLauncher } from './browser-launcher.js';
import { closeBrowser, newSessionContext } from './browser-launcher.js';
import type { NotionSession, NotionSessionStore } from './notion-session.js';
import { captureSession, sessionCookiesChanged } from './notion-session.js';
import type { ExportDialog } from './notion-settings-page.js';
import {
  collectUiLandmarks,
  NotionSettingsPage,
  waitForExportProgress,
} from './notion-settings-page.js';
import { passSessionGate } from './session-gate.js';

/** S2: 15 s per step was too tight on Vercel, 30 s always sufficed. */
export const DEFAULT_STEP_TIMEOUT_MS = 30_000;

/** A `NOTION_UI_CHANGED` failure is retried once after a reload (Failure And Retry). */
const UI_ATTEMPTS = 2;

export interface PlaywrightNotionExportTriggerOptions {
  /** Dates the cookies' expiry check when the session is saved again. */
  readonly clock?: Clock;
  readonly exportFormat: NotionExportFormat;
  /** False opens a visible window (`dev:trigger --headed`). */
  readonly headless?: boolean;
  readonly launcher: BrowserLauncher;
  /** Step names, durations and outcomes only: never a URL, cookie or page content. */
  readonly logger: Logger;
  /** `save` keeps the session rolling: after a passed gate, changed cookies are saved again. */
  readonly sessions: Pick<NotionSessionStore, 'load' | 'save'>;
  readonly stepTimeoutMs?: number;
  readonly workspace: { readonly name: string; readonly url: string };
}

/** `dev:trigger --dry-run`: how far the run got without the final click. */
export type ExportRehearsal =
  | {
      /** The dialog values this run set to Phase 0's; empty when all matched. */
      readonly changed: readonly string[];
      readonly outcome: 'dialog_ready';
      readonly settingsOpenedBy: 'menu' | 'shortcut';
    }
  | { readonly outcome: 'in_progress' };

interface ReadyDialog {
  readonly button: Locator;
  readonly changed: readonly string[];
  readonly dialog: ExportDialog;
  readonly settingsOpenedBy: 'menu' | 'shortcut';
}

/**
 * `NotionExportTrigger` with Playwright. Every call decrypts the saved session into a new
 * browser context, replays the identity it was captured with, and closes the browser at the
 * end, whatever the outcome. Opening the dialog is safe to repeat; the final click happens only
 * in `requestExport`, right after `onBeforeFinalClick`, and once at most. A call that passed the
 * session gate saves the session again when Notion changed its cookies, so the sign-in rolls
 * forward instead of ageing out.
 */
export class PlaywrightNotionExportTrigger implements NotionExportTrigger {
  private readonly clock: Clock;
  private readonly exportFormat: NotionExportFormat;
  private readonly headless: boolean;
  private readonly launcher: BrowserLauncher;
  private readonly logger: Logger;
  private readonly sessions: Pick<NotionSessionStore, 'load' | 'save'>;
  private readonly stepTimeoutMs: number;
  private readonly workspace: { readonly name: string; readonly url: string };

  constructor({
    clock = systemClock,
    exportFormat,
    headless = true,
    launcher,
    logger,
    sessions,
    stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
    workspace,
  }: PlaywrightNotionExportTriggerOptions) {
    this.clock = clock;
    this.exportFormat = exportFormat;
    this.headless = headless;
    this.launcher = launcher;
    this.logger = logger;
    this.sessions = sessions;
    this.stepTimeoutMs = stepTimeoutMs;
    this.workspace = workspace;
  }

  /**
   * The daily cron's Notion probe: the gate, then Settings up to the export dialog, which is
   * cancelled, and the saved download credential after refresh. A successful app-session
   * check alone must not resume a transfer whose file cookie is still missing or expired.
   */
  async probeExportDialog(signal?: AbortSignal): Promise<NotionProbeResult> {
    const exportDialog = await this.withPage(signal, async (page) => {
      const ready = await this.openDialog(page, signal);

      if (ready !== 'in_progress') {
        await ready.dialog.cancel();
      }

      return ready === 'in_progress' ? 'in_progress' : 'ready';
    });

    signal?.throwIfAborted();

    // Reload after withPage's best-effort refresh: the transfer uses the persisted cookies,
    // so a renewed browser cookie whose save failed is not enough to report recovery.
    const session = await abortable(this.sessions.load(), signal);
    const captured = captureSession(session.storageState, session.fingerprint, this.clock.now());

    if (!captured.fileHostCookie) {
      throw new IntegrationError(
        'NOTION_SESSION_EXPIRED',
        'The saved Notion session has no unexpired file_token cookie for file.notion.com',
      );
    }

    return {
      exportDialog,
      ...(captured.authCookieExpiresAt === undefined
        ? {}
        : { authCookieExpiresAt: captured.authCookieExpiresAt }),
    };
  }

  async probeSession(signal?: AbortSignal): Promise<SessionProbe> {
    return this.withPage(signal, async (page, session) => {
      await this.gate(page, signal);
      this.logger.info('notion.session.valid', { createdAt: session.createdAt });

      return session.authCookieExpiresAt === undefined
        ? { state: 'valid' }
        : { authCookieExpiresAt: session.authCookieExpiresAt, state: 'valid' };
    });
  }

  /** Everything up to the final click: the gate, Settings, the dialog values, the button. Then Cancel. */
  async rehearseExport(signal?: AbortSignal): Promise<ExportRehearsal> {
    return this.withPage(signal, async (page) => {
      const ready = await this.openDialog(page, signal);

      if (ready === 'in_progress') {
        return { outcome: 'in_progress' };
      }

      await ready.dialog.cancel();

      return {
        changed: ready.changed,
        outcome: 'dialog_ready',
        settingsOpenedBy: ready.settingsOpenedBy,
      };
    });
  }

  async requestExport({
    onBeforeFinalClick,
    signal,
  }: ExportRequest): Promise<{ readonly outcome: ExportTriggerOutcome }> {
    return this.withPage(signal, async (page) => {
      const ready = await this.openDialog(page, signal);

      if (ready === 'in_progress') {
        this.logger.info('notion.export.already_in_progress');

        return { outcome: 'already_in_progress' };
      }

      signal?.throwIfAborted();
      // Still before the click: an abort while the job saves `exportClickAt` rejects at once,
      // and an abort as it finishes is caught by the check below, so no click is ever sent.
      await abortable(onBeforeFinalClick(), signal);
      signal?.throwIfAborted();

      return { outcome: await this.clickExport(page, ready.button, signal) };
    });
  }

  /**
   * The final click and the wait for Notion's confirmation. Nothing here throws: once the click
   * is sent, the export may have started, so any failure is `in_doubt`.
   */
  private async clickExport(
    page: Page,
    button: Locator,
    signal: AbortSignal | undefined,
  ): Promise<ExportTriggerOutcome> {
    try {
      await button.click({ timeout: this.stepTimeoutMs });
      this.logger.info('notion.export.clicked');

      if (await abortable(waitForExportProgress(page, this.stepTimeoutMs), signal)) {
        this.logger.info('notion.export.confirmed');

        return 'confirmed';
      }

      this.logger.warn('notion.export.unconfirmed', { reason: 'no_confirmation' });
    } catch (error) {
      this.logger.warn('notion.export.unconfirmed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }

    return 'in_doubt';
  }

  private async gate(page: Page, signal: AbortSignal | undefined): Promise<Locator> {
    return passSessionGate(page, {
      signal,
      timeoutMs: this.stepTimeoutMs,
      workspaceName: this.workspace.name,
      workspaceUrl: this.workspace.url,
    });
  }

  /** The session gate, then Settings up to a ready dialog. A UI failure reloads once and retries. */
  private async openDialog(
    page: Page,
    signal: AbortSignal | undefined,
  ): Promise<'in_progress' | ReadyDialog> {
    for (let attempt = 1; ; attempt += 1) {
      const started = performance.now();
      // The gate loads the workspace page, so the second attempt starts from a fresh page.
      const workspaceSwitcher = await this.gate(page, signal);

      try {
        const ready = await this.walkToDialog(page, workspaceSwitcher, signal);

        this.logger.info('notion.dialog.done', {
          attempt,
          durationMs: Math.round(performance.now() - started),
          ...(ready === 'in_progress'
            ? { outcome: 'in_progress' }
            : {
                changed: ready.changed,
                outcome: 'ready',
                settingsOpenedBy: ready.settingsOpenedBy,
              }),
        });

        return ready;
      } catch (error) {
        const uiChanged = error instanceof IntegrationError && error.code === 'NOTION_UI_CHANGED';

        if (!uiChanged) {
          throw error;
        }

        if (attempt >= UI_ATTEMPTS) {
          // The supervisor gets the dialog's landmarks, never its text or a screenshot.
          throw new IntegrationError('NOTION_UI_CHANGED', error.message, {
            uiLandmarks: await collectUiLandmarks(page, this.workspace.name),
          });
        }

        signal?.throwIfAborted();
        this.logger.warn('notion.ui.retry', { attempt, message: error.message });
      }
    }
  }

  private async walkToDialog(
    page: Page,
    workspaceSwitcher: Locator,
    signal: AbortSignal | undefined,
  ): Promise<'in_progress' | ReadyDialog> {
    const settings = new NotionSettingsPage(page, {
      stepTimeoutMs: this.stepTimeoutMs,
      workspaceSwitcher,
    });
    const settingsOpenedBy = await settings.open();

    signal?.throwIfAborted();
    await settings.openGeneral();
    signal?.throwIfAborted();

    const dialog = await settings.openExportDialog();

    if (dialog === 'in_progress') {
      return 'in_progress';
    }

    signal?.throwIfAborted();

    const changed = await dialog.applySettings(this.exportFormat);
    const button = await dialog.exportButton();

    return { button, changed, dialog, settingsOpenedBy };
  }

  /**
   * Loads the session, launches the browser and opens one page for `run`. An abort closes the
   * browser at once, which ends any wait, and the call rejects with the signal's reason.
   */
  private async withPage<T>(
    signal: AbortSignal | undefined,
    run: (page: Page, session: NotionSession) => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();

    const session = await this.sessions.load();
    const browser = await this.launcher.launch({ headless: this.headless });

    const onAbort = () => {
      void closeBrowser(browser);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      signal?.throwIfAborted();

      const context = await newSessionContext(browser, session);
      const page = await context.newPage();

      page.setDefaultTimeout(this.stepTimeoutMs);

      const result = await run(page, session);

      await this.refreshSession(context, session);

      return result;
    } catch (error) {
      signal?.throwIfAborted();

      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await closeBrowser(browser);
    }
  }

  /**
   * The rolling refresh: after `run` passed the gate, the browser's Notion cookies are saved
   * again if they changed, with the identity the session was saved with. A capture without the
   * sign-in or the file host's cookie keeps the saved one. Best effort: it never throws, since
   * it may follow the final Export click.
   */
  private async refreshSession(context: BrowserContext, session: NotionSession): Promise<void> {
    try {
      const captured = captureSession(
        await context.storageState(),
        session.fingerprint,
        this.clock.now(),
      );

      if (
        !captured.fileHostCookie ||
        !sessionCookiesChanged(session.storageState, captured.storageState)
      ) {
        return;
      }

      await this.sessions.save(captured);
      this.logger.info('notion.session.refreshed', {
        ...(captured.authCookieExpiresAt === undefined
          ? {}
          : { authCookieExpiresAt: captured.authCookieExpiresAt }),
      });
    } catch (error) {
      this.logger.warn('notion.session.refresh_failed', {
        reason: error instanceof IntegrationError ? error.code : errorName(error),
      });
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
