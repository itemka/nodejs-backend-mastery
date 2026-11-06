import type { Locator, Page, Route } from 'playwright-core';

import { NotionLoginError } from '../../application/notion-login-error.js';
import type {
  LoginCodeFinder,
  NotionEmailLogin,
  RenewedNotionSession,
} from '../../application/ports.js';
import { abortable } from '../../shared/abortable.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import type { Logger } from '../../shared/logger.js';
import type { SecretValue } from '../../shared/secret-value.js';
import { pause, systemSleep } from '../../shared/sleep.js';
import type { BrowserLauncher } from './browser-launcher.js';
import { closeBrowser, newSessionContext } from './browser-launcher.js';
import type { NotionSessionStore } from './notion-session.js';
import { captureSession, isNotionHost } from './notion-session.js';
import {
  APP_SHELL,
  CHALLENGE,
  challengeTitle,
  classifyPage,
  NOTION_LOGIN_URL,
  passSessionGate,
} from './session-gate.js';

/** Each page step; S2 found 15 s too short for the app. */
const STEP_TIMEOUT_MS = 30_000;
const POLL_MS = 250;
/** If the code screen still shows this long after Enter, Continue is clicked once (S7). */
const SUBMIT_FALLBACK_MS = 3000;

const EMAIL_INPUT = 'input[type="email"]';
/** S7: `autocomplete="one-time-code"`, labelled "Verification code"; the rest are fallbacks. */
const CODE_INPUT = [
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[placeholder*="code" i]',
  'input[aria-label*="code" i]',
].join(', ');
/**
 * A password prompt is a labelled field. The login page always holds an unlabelled
 * `current-password` input for password managers, which Playwright counts as visible (S7).
 */
const PASSWORD_PROMPT = /password/i;
const CONTINUE = /^continue$/i;
/** A choice of the email code, if Notion ever offers one after the email: never Google or a password. */
const EMAIL_METHOD =
  /continue with (?:e-?mail|(?:a )?(?:login |verification )?code)|(?:e-?mail|send) (?:me )?(?:a )?(?:login |verification )?code|use (?:a )?(?:login |verification )?code/i;

const EMPTY_STATE = { cookies: [], origins: [] };

export interface PlaywrightNotionEmailLoginOptions {
  readonly clock?: Clock;
  readonly codes: LoginCodeFinder;
  readonly launcher: BrowserLauncher;
  readonly logger: Logger;
  /** `OWNER_GOOGLE_EMAIL`: typed into the login page only if it is the Gmail profile's address. */
  readonly ownerEmail: string;
  readonly sessions: Pick<NotionSessionStore, 'identity' | 'save'>;
  readonly stepTimeoutMs?: number;
  readonly workspace: { readonly name: string; readonly url: string };
}

/**
 * `NotionEmailLogin` with Playwright, as spike S7 proved it on Vercel: a new context with the
 * saved identity, the email, the code from Gmail typed and submitted with Enter, the session
 * gate, then `captureSession` and the save, as `auth:notion` does. The code is a `SecretValue`
 * that leaves only into the code field: until the code is in, every main-frame navigation off a
 * Notion host over HTTPS is aborted, nothing is typed or clicked off Notion, and a failed action
 * is rethrown as static text, since Playwright's own errors quote what was filled. Logs name
 * stages, never values.
 */
export class PlaywrightNotionEmailLogin implements NotionEmailLogin {
  private readonly options: Required<PlaywrightNotionEmailLoginOptions>;
  private readonly ownerEmail: string;

  constructor(options: PlaywrightNotionEmailLoginOptions) {
    this.options = { clock: systemClock, stepTimeoutMs: STEP_TIMEOUT_MS, ...options };
    this.ownerEmail = options.ownerEmail.trim().toLowerCase();
  }

  async renewSession(signal: AbortSignal): Promise<RenewedNotionSession> {
    const started = performance.now();

    const stage = (name: string) => {
      this.options.logger.info('notion.login.stage', {
        atMs: Math.round(performance.now() - started),
        stage: name,
      });
    };

    const identity = await abortable(this.options.sessions.identity(), signal);

    if (identity === undefined) {
      throw new NotionLoginError('no_identity', 'No saved browser identity to replay');
    }

    if ((await this.options.codes.mailbox(signal)) !== this.ownerEmail) {
      throw new NotionLoginError('owner_mismatch', 'OWNER_GOOGLE_EMAIL is not the Gmail address');
    }

    const browser = await this.options.launcher.launch({ headless: true });

    // Ends an action in flight at once: after the deadline, nothing more reaches the page, so no
    // code is submitted for a session that would never be saved.
    const closeOnAbort = () => {
      void closeBrowser(browser);
    };

    signal.addEventListener('abort', closeOnAbort, { once: true });

    try {
      signal.throwIfAborted();

      const context = await newSessionContext(browser, {
        fingerprint: identity,
        storageState: EMPTY_STATE,
      });
      const page = await context.newPage();
      const navigation = new NotionOnlyNavigation(page);

      // Until the code is in: Playwright follows a navigation in the middle of a fill, so a host
      // check before each action alone could still type the code into another site's field.
      await page.route('**/*', navigation.handle);
      stage('launch');

      const requestedAt = await this.requestCode(page, navigation, signal);

      stage('code_requested');

      const code = await this.options.codes.waitForCode({ requestedAt, signal });

      stage('code_found');
      await this.enterCode(page, navigation, code, signal);
      await page.unroute('**/*', navigation.handle);
      stage('signed_in');
      await passSessionGate(page, {
        signal,
        timeoutMs: this.options.stepTimeoutMs,
        workspaceName: this.options.workspace.name,
        workspaceUrl: this.options.workspace.url,
      });
      stage('gate');

      const captured = captureSession(
        await context.storageState(),
        identity,
        this.options.clock.now(),
      );

      if (!captured.fileHostCookie) {
        throw new NotionLoginError(
          'no_file_cookie',
          'The new session has no file_token cookie for file.notion.com',
        );
      }

      signal.throwIfAborted();
      // Not aborted from here: a half-written save is worse than a late one.
      await this.options.sessions.save(captured);
      stage('saved');

      return captured.authCookieExpiresAt === undefined
        ? {}
        : { authCookieExpiresAt: captured.authCookieExpiresAt };
    } finally {
      signal.removeEventListener('abort', closeOnAbort);
      await closeBrowser(browser);
    }
  }

  /** The login page, the email, then the code field. Returns when the code was requested. */
  private async requestCode(
    page: Page,
    navigation: NotionOnlyNavigation,
    signal: AbortSignal,
  ): Promise<Date> {
    const emailInput = visible(page.locator(EMAIL_INPUT));
    const codeInput = visible(page.locator(CODE_INPUT).or(page.getByLabel(/code/i)));
    const passwordInput = visible(
      page.getByLabel(PASSWORD_PROMPT).or(page.getByPlaceholder(PASSWORD_PROMPT)),
    );
    const methodButton = visible(
      page
        .getByRole('button', { name: EMAIL_METHOD })
        .or(page.getByRole('link', { name: EMAIL_METHOD })),
    );
    const continueButton = visible(page.getByRole('button', { name: CONTINUE }));

    try {
      await page.goto(NOTION_LOGIN_URL, {
        timeout: this.options.stepTimeoutMs,
        waitUntil: 'domcontentloaded',
      });
    } catch {
      signal.throwIfAborted();

      throw new NotionLoginError('unavailable', 'The Notion login page did not load');
    }

    await this.waitForAny(page, navigation, { email: emailInput }, signal);
    await this.act(page, navigation, signal, () =>
      emailInput.fill(this.ownerEmail, this.actionOptions()),
    );

    const requestedAt = this.options.clock.now();
    const submit = (await isShown(continueButton))
      ? () => continueButton.click(this.actionOptions())
      : () => emailInput.press('Enter', this.actionOptions());

    await this.act(page, navigation, signal, submit);

    let shown = await this.waitForAny(
      page,
      navigation,
      { code: codeInput, method: methodButton, password: passwordInput },
      signal,
    );

    if (shown === 'method') {
      await this.act(page, navigation, signal, () => methodButton.click(this.actionOptions()));
      shown = await this.waitForAny(
        page,
        navigation,
        { code: codeInput, password: passwordInput },
        signal,
      );
    }

    if (shown === 'password') {
      throw new NotionLoginError('password_prompt', 'Notion asked for a password, not a code');
    }

    // The code field must be Notion's own before Gmail is even asked for the code.
    assertOnNotion(page, navigation);

    return requestedAt;
  }

  /**
   * Types the code and waits for the app shell. Enter submits it (S7); if the code screen still
   * shows a few seconds later, Continue is clicked once.
   */
  private async enterCode(
    page: Page,
    navigation: NotionOnlyNavigation,
    code: SecretValue<string>,
    signal: AbortSignal,
  ): Promise<void> {
    const codeInput = visible(page.locator(CODE_INPUT).or(page.getByLabel(/code/i)));
    const continueButton = visible(page.getByRole('button', { name: CONTINUE }));

    await this.act(page, navigation, signal, () =>
      codeInput.fill(code.reveal(), this.actionOptions()),
    );
    await this.act(page, navigation, signal, () => codeInput.press('Enter', this.actionOptions()));

    const started = performance.now();
    let clicked = false;

    while (performance.now() - started < this.options.stepTimeoutMs) {
      assertOnNotion(page, navigation);

      const [appShell, challenge, title] = await Promise.all([
        isShown(page.locator(APP_SHELL).first()),
        isShown(page.locator(CHALLENGE).first()),
        page.title().catch(() => ''),
      ]);

      // Before the classifier, which names any `/login` page `login`: a challenge shown on the
      // login page after the code must stop the attempt, not earn a Continue click.
      if (challenge || challengeTitle.test(title)) {
        throw new NotionLoginError('challenge', 'Notion showed a verification page');
      }

      const verdict = classifyPage({
        appShell,
        challenge,
        path: new URL(page.url()).pathname,
        title,
      });

      if (verdict === 'authenticated') {
        return;
      }

      if (
        !clicked &&
        verdict === 'login' &&
        performance.now() - started > SUBMIT_FALLBACK_MS &&
        (await isShown(continueButton))
      ) {
        clicked = true;
        await this.act(page, navigation, signal, () => continueButton.click(this.actionOptions()));
      }

      await pause(systemSleep, POLL_MS, signal);
    }

    throw new NotionLoginError('not_signed_in', 'The app did not render after the code');
  }

  /**
   * One page action, only on a Notion host over HTTPS and only within the deadline, checked
   * before and after it: an action that succeeds after the deadline still stops the login, so
   * the next one (the code's Enter) is never sent. Playwright's error would quote the filled
   * value in its call log, so a failure is rethrown as static text with no cause; an abort keeps
   * the signal's reason.
   */
  private async act(
    page: Page,
    navigation: NotionOnlyNavigation,
    signal: AbortSignal,
    action: () => Promise<void>,
  ): Promise<void> {
    signal.throwIfAborted();
    assertOnNotion(page, navigation);

    try {
      await action();
    } catch {
      signal.throwIfAborted();
      assertOnNotion(page, navigation);

      throw new NotionLoginError('ui_changed', 'A login page action failed');
    }

    signal.throwIfAborted();
  }

  private actionOptions(): { readonly timeout: number } {
    return { timeout: this.options.stepTimeoutMs };
  }

  /** The first of `targets` that shows; a challenge or the step's timeout ends the wait. */
  private async waitForAny<K extends string>(
    page: Page,
    navigation: NotionOnlyNavigation,
    targets: Readonly<Record<K, Locator>>,
    signal: AbortSignal,
  ): Promise<K> {
    const started = performance.now();

    while (performance.now() - started < this.options.stepTimeoutMs) {
      assertOnNotion(page, navigation);

      const [challenge, title] = await Promise.all([
        isShown(page.locator(CHALLENGE).first()),
        page.title().catch(() => ''),
      ]);

      if (challenge || challengeTitle.test(title)) {
        throw new NotionLoginError('challenge', 'Notion showed a verification page');
      }

      for (const [key, locator] of Object.entries<Locator>(targets)) {
        if (await isShown(locator)) {
          return key as K;
        }
      }

      await pause(systemSleep, POLL_MS, signal);
    }

    throw new NotionLoginError(
      'ui_changed',
      `The login page showed none of: ${Object.keys(targets).join(', ')}`,
    );
  }
}

/**
 * Aborts every main-frame navigation off a Notion host over HTTPS while the login page is in use,
 * and remembers that one was tried. Other requests, and frames inside the page, pass untouched.
 */
class NotionOnlyNavigation {
  /** A navigation off Notion was tried and stopped. */
  blocked = false;

  constructor(private readonly page: Page) {}

  readonly handle = async (route: Route): Promise<void> => {
    const request = route.request();

    if (
      request.isNavigationRequest() &&
      request.frame() === this.page.mainFrame() &&
      !isNotionUrl(request.url())
    ) {
      this.blocked = true;
      await route.abort('blockedbyclient');

      return;
    }

    await route.fallback();
  };
}

/** The login may hand off to another site (an identity provider): nothing is typed there. */
function assertOnNotion(page: Page, navigation: NotionOnlyNavigation): void {
  if (navigation.blocked || !isNotionUrl(page.url())) {
    throw new NotionLoginError('ui_changed', 'The login page left Notion');
  }
}

function isNotionUrl(href: string): boolean {
  try {
    const url = new URL(href);

    return url.protocol === 'https:' && isNotionHost(url.hostname);
  } catch {
    return false;
  }
}

function visible(locator: Locator): Locator {
  return locator.filter({ visible: true }).first();
}

/** A page that navigates meanwhile answers false, not an error. */
function isShown(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}
