import type { Locator, Page } from 'playwright-core';

import { IntegrationError } from '../../application/integration-error.js';
import { pause, systemSleep } from '../../shared/sleep.js';

/** `www.notion.so/login` redirects here (Phase 0). */
export const NOTION_LOGIN_URL = 'https://app.notion.com/login';

/** Notion's app shell; the login page has neither element (S2). */
const APP_SHELL = '[class*="notion-sidebar"], .notion-frame';

/** CAPTCHA and bot-check widgets: Cloudflare (Turnstile and its interstitial), hCaptcha, reCAPTCHA. */
const CHALLENGE = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="recaptcha"]',
  '#challenge-form',
  '#challenge-running',
].join(', ');

/** The titles of interstitial verification pages. */
const challengeTitle = /just a moment|attention required|verify (?:that )?you are (?:a )?human/i;

const loginPath = /^\/login(?:\/|$)/;

const POLL_MS = 250;

/** What the gate reads from the page: no content, only the path, the title and two selectors. */
export interface PageObservation {
  readonly appShell: boolean;
  readonly challenge: boolean;
  readonly path: string;
  readonly title: string;
}

/**
 * - `login`: the app sent the browser to its login page. Without a session the server still
 *   answers `200`, so only the rendered page tells (Phase 0);
 * - `challenge`: a CAPTCHA or verification page;
 * - `authenticated`: the app shell rendered;
 * - `loading`: none of these yet.
 */
export type PageVerdict = 'authenticated' | 'challenge' | 'loading' | 'login';

export function classifyPage({ appShell, challenge, path, title }: PageObservation): PageVerdict {
  if (loginPath.test(path)) {
    return 'login';
  }

  if (challenge || challengeTitle.test(title)) {
    return 'challenge';
  }

  return appShell ? 'authenticated' : 'loading';
}

/** A custom workspace icon before the name: one emoji, with its modifiers and joined parts. */
const EMOJI_AVATAR = String.raw`\p{Extended_Pictographic}[\p{Emoji_Modifier}\u{FE0F}\u{200D}\p{Extended_Pictographic}]*`;

const SPACES = String.raw`\s+`;

/**
 * The switcher's whole accessible name: optionally the workspace icon and a space, then exactly
 * the workspace name. A letter icon is the name's own initial, in either case, so another
 * workspace whose name is one character longer ("A Team" for "Team") never passes as an icon
 * plus this name. `'` and `’` count as equal (Phase 0), a run of spaces as one, and every other
 * character is literal, so a workspace whose name only contains this one never matches.
 */
export function workspaceNamePattern(name: string): RegExp {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word].map((character) => literalCharacter(character)).join(''));
  const initial = [...name.trim()][0] ?? '';
  const initials = new Set([initial.toUpperCase(), initial.toLowerCase()]);
  const avatar = [...initials].map((character) => literalCharacter(character)).join('|');

  return new RegExp(`^(?:(?:${avatar}|${EMOJI_AVATAR})${SPACES})?${words.join(SPACES)}$`, 'u');
}

/**
 * ASCII punctuation is written as `\xHH`. Playwright 1.63 leaves quotes unescaped in a `u`
 * pattern, and a raw `'`, `"`, backtick or `>` then breaks a chained selector such as
 * `.filter({ visible: true })` ("unexpected symbol").
 */
function literalCharacter(character: string): string {
  if (character === "'" || character === '’') {
    return String.raw`[\x27’]`;
  }

  const code = character.codePointAt(0) ?? 0;

  if (/[\dA-Za-z]/.test(character) || code >= 0x80) {
    return character;
  }

  return String.raw`\x${code.toString(16).padStart(2, '0')}`;
}

export interface SessionGateOptions {
  readonly signal?: AbortSignal | undefined;
  /** For the page load, the app to render, and the workspace switcher each. */
  readonly timeoutMs: number;
  readonly workspaceName: string;
  readonly workspaceUrl: string;
}

/**
 * Opens the workspace page and checks the session the page holds: the app must render signed
 * in, and the sidebar's workspace switcher must show the workspace name. Returns the switcher,
 * which opens Settings. Throws `IntegrationError`:
 * - `NOTION_SESSION_EXPIRED`: the app went to its login page;
 * - `NOTION_INTERACTIVE_CHALLENGE`: a CAPTCHA or verification page;
 * - `NOTION_WRONG_WORKSPACE`: signed in, but the switcher shows another name;
 * - `NOTION_UNAVAILABLE`: the page failed to load, answered 5xx, or never rendered.
 */
export async function passSessionGate(page: Page, options: SessionGateOptions): Promise<Locator> {
  const { signal, timeoutMs, workspaceName, workspaceUrl } = options;
  let status: number | undefined;

  try {
    const response = await page.goto(workspaceUrl, {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    });

    status = response?.status();
  } catch {
    signal?.throwIfAborted();

    throw new IntegrationError('NOTION_UNAVAILABLE', 'The Notion workspace page did not load');
  }

  if (status !== undefined && status >= 500) {
    throw new IntegrationError('NOTION_UNAVAILABLE', `Notion answered ${status}`);
  }

  const verdict = await settle(page, timeoutMs, signal);

  switch (verdict) {
    case 'authenticated': {
      break;
    }

    case 'challenge': {
      throw new IntegrationError(
        'NOTION_INTERACTIVE_CHALLENGE',
        'Notion showed a verification page',
      );
    }

    case 'loading': {
      throw new IntegrationError('NOTION_UNAVAILABLE', 'The Notion app did not render in time');
    }

    case 'login': {
      throw new IntegrationError(
        'NOTION_SESSION_EXPIRED',
        'Notion sent the browser to its login page',
      );
    }
  }

  // Hidden copies of the name exist (S2), so only a visible button counts.
  const switcher = page
    .getByRole('button', { name: workspaceNamePattern(workspaceName) })
    .filter({ visible: true })
    .first();

  try {
    await switcher.waitFor({ timeout: timeoutMs });
  } catch {
    signal?.throwIfAborted();

    throw new IntegrationError(
      'NOTION_WRONG_WORKSPACE',
      'The workspace switcher does not show NOTION_WORKSPACE_NAME',
    );
  }

  return switcher;
}

/**
 * Waits until the app renders signed in, which you do yourself in the window: the login page
 * and any verification page are part of that. Throws `NOTION_SESSION_EXPIRED` after `timeoutMs`.
 */
export async function waitForSignIn(
  page: Page,
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<void> {
  const deadline = performance.now() + options.timeoutMs;

  while (performance.now() < deadline) {
    const observation = await observe(page);

    if (observation !== undefined && classifyPage(observation) === 'authenticated') {
      return;
    }

    await pause(systemSleep, 1000, options.signal);
  }

  throw new IntegrationError('NOTION_SESSION_EXPIRED', 'Nobody signed in to Notion in time');
}

/** Polls the page until it is no longer `loading`, or until `timeoutMs` passes. */
async function settle(
  page: Page,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<PageVerdict> {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    const observation = await observe(page);
    const verdict = observation === undefined ? 'loading' : classifyPage(observation);

    if (verdict !== 'loading') {
      return verdict;
    }

    await pause(systemSleep, POLL_MS, signal);
  }

  return 'loading';
}

/** Undefined while the page navigates, which replaces the document the selectors run in. */
async function observe(page: Page): Promise<PageObservation | undefined> {
  if (page.isClosed()) {
    throw new IntegrationError('NOTION_UNAVAILABLE', 'The Notion page closed');
  }

  try {
    const [appShell, challenge, title] = await Promise.all([
      page.locator(APP_SHELL).first().isVisible(),
      page.locator(CHALLENGE).first().isVisible(),
      page.title(),
    ]);

    return { appShell, challenge, path: new URL(page.url()).pathname, title };
  } catch {
    return undefined;
  }
}
