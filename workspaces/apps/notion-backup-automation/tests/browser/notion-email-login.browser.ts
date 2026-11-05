import type { Browser, Route } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import type { BrowserLauncher } from '../../src/adapters/notion/browser-launcher.js';
import { LocalBrowserLauncher } from '../../src/adapters/notion/browser-launcher.js';
import { PlaywrightNotionEmailLogin } from '../../src/adapters/notion/notion-email-login.js';
import type { CapturedSession } from '../../src/adapters/notion/notion-session.js';
import type { LoginCodeFinder } from '../../src/application/ports.js';
import { createLogger } from '../../src/shared/logger.js';
import { SecretValue } from '../../src/shared/secret-value.js';
import { FAKE_FINGERPRINT } from '../support/fake-notion-browser.js';

/*
 * The email-code login against local stand-ins for Notion's pages, served on the real
 * `https://app.notion.com` origin through Playwright routing, so the page can set Notion-domain
 * cookies as the real one does. Shapes from S7: the email field, then a "Verification code"
 * field on the same `/login` page; Enter submits the code. Never opens Notion.
 */

const CODE = 'Qx7mKp';
const WORKSPACE_URL = 'https://app.notion.com/p/workspace';
const EXPIRES = 'Fri, 05 Nov 2027 15:03:59 GMT';

type LoginMode =
  | 'challenge'
  | 'challenge_after_code'
  | 'code'
  | 'enter_ignored'
  | 'leaves_notion'
  | 'navigates_during_fill'
  | 'never_signs_in'
  | 'password'
  | 'readonly_code'
  | 'slow_fill';

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/** Notion's login page as S7 saw it, or a variant. The hidden password-manager field is real. */
function loginPage(mode: LoginMode): string {
  if (mode === 'challenge') {
    return page('Just a moment...', '<div>Checking your browser</div>');
  }

  const readonly =
    { navigates_during_fill: ' disabled', readonly_code: ' readonly' }[
      mode as 'navigates_during_fill' | 'readonly_code'
    ] ?? '';
  const afterEmail =
    mode === 'password'
      ? `<label for="pw">Password</label><input id="pw" type="password">`
      : `<label for="code">Verification code</label><input id="code" type="text" autocomplete="one-time-code" placeholder="Enter code"${readonly}>`;
  const handOff =
    mode === 'leaves_notion' ? "location.assign('https://idp.example.com/sso'); return;" : '';
  // While the fill waits for the disabled field, the page tries to move to another site.
  const later =
    mode === 'navigates_during_fill'
      ? "setTimeout(() => location.assign('https://idp.example.com/sso'), 500);"
      : '';
  const slowInput =
    mode === 'slow_fill'
      ? "code.addEventListener('input', () => { const end = Date.now() + 800; while (Date.now() < end) {} });"
      : '';
  const challengeFrame =
    '<iframe src="https://challenges.cloudflare.com/turnstile" style="width:300px;height:65px"></iframe>';
  const session = `document.cookie = 'token_v2=new-session; domain=.app.notion.com; path=/; secure; expires=${EXPIRES}';
         document.cookie = 'file_token=new-file; domain=.notion.com; path=/; secure; expires=${EXPIRES}';
         location.assign('/');`;
  const accepted = `code.value === ${JSON.stringify(CODE)} && window.requestedFor === 'user@example.com'`;
  // What Enter on the code field does once the right code is in.
  const signIn =
    {
      challenge_after_code: `document.getElementById('next').insertAdjacentHTML('beforeend', ${JSON.stringify(challengeFrame)});`,
      enter_ignored: '',
      never_signs_in: '',
    }[mode as 'challenge_after_code' | 'enter_ignored' | 'never_signs_in'] ?? session;
  // Enter does nothing here, so only Continue submits the code; the session starts once the
  // click has reached the server, so the click is always counted.
  const continueSignIn =
    mode === 'enter_ignored'
      ? `fetch('/continue-after-code').then(() => { if (${accepted}) { ${session} } });`
      : "fetch('/continue-after-code');";

  return page(
    'Notion - Log in',
    `<form id="form" onsubmit="return false">
       <label for="email">Email</label>
       <input id="email" type="email" placeholder="Enter your email address...">
       <input type="password" autocomplete="current-password" style="opacity:0;position:absolute">
       <div id="next"></div>
       <button type="button" id="continue">Continue</button>
     </form>
     <script>
       document.getElementById('continue').addEventListener('click', () => {
         if (document.getElementById('code')) {
           const code = document.getElementById('code');
           ${continueSignIn}
           return;
         }
         ${handOff}
         window.requestedFor = document.getElementById('email').value;
         document.getElementById('next').innerHTML = ${JSON.stringify(afterEmail)};
         ${later}
         const code = document.getElementById('code');
         if (code) ${slowInput}
         if (code) code.addEventListener('keydown', (event) => {
           if (event.key === 'Enter') fetch('/code-submitted');
           if (event.key === 'Enter' && ${accepted}) { ${signIn} }
         });
       });
     </script>`,
  );
}

const APP = page(
  'Notion',
  '<div class="notion-sidebar"><div role="button">Test User’s Notion</div></div><div class="notion-frame">Home</div>',
);

/** The installed Chrome, with `app.notion.com` answered by the fixtures in every context. */
function routedLauncher(mode: LoginMode, hits: string[]): BrowserLauncher {
  const local = new LocalBrowserLauncher();

  return {
    launch: async (options) => {
      const browser = await local.launch(options);
      const newContext = browser.newContext.bind(browser);

      (browser as { newContext: Browser['newContext'] }).newContext = async (contextOptions) => {
        const context = await newContext(contextOptions);

        await context.route('https://app.notion.com/**', (route: Route) => {
          const { pathname } = new URL(route.request().url());

          hits.push(`app.notion.com${pathname}`);

          return route.fulfill({
            body: pathname === '/login' ? loginPage(mode) : APP,
            contentType: 'text/html; charset=utf-8',
          });
        });
        await context.route('https://www.notion.so/**', (route) => route.abort());
        // Another site the login could hand off to: it shows a code field too.
        await context.route('https://idp.example.com/**', (route) => {
          hits.push('idp.example.com');

          return route.fulfill({
            body: page(
              'Sign in',
              '<label for="c">Verification code</label><input id="c" autocomplete="one-time-code">',
            ),
            contentType: 'text/html; charset=utf-8',
          });
        });
        await context.route('https://challenges.cloudflare.com/**', (route) =>
          route.fulfill({ body: page('Verify', '<div>Verify</div>'), contentType: 'text/html' }),
        );

        return context;
      };

      return browser;
    },
  };
}

function setup(
  mode: LoginMode,
  options: {
    abortAfterCodeMs?: number;
    identity?: boolean;
    mailbox?: string;
    stepTimeoutMs?: number;
  } = {},
) {
  const controller = new AbortController();
  const saved: CapturedSession[] = [];
  const requests: Date[] = [];
  const hits: string[] = [];
  const logs: string[] = [];
  const codes: LoginCodeFinder = {
    mailbox: () => Promise.resolve(options.mailbox ?? 'user@example.com'),
    waitForCode: ({ requestedAt }) => {
      requests.push(requestedAt);

      if (options.abortAfterCodeMs !== undefined) {
        setTimeout(() => {
          controller.abort(new Error('budget'));
        }, options.abortAfterCodeMs);
      }

      return Promise.resolve(new SecretValue(CODE));
    },
  };
  const login = new PlaywrightNotionEmailLogin({
    clock: { now: () => new Date('2026-11-05T15:03:30.000Z') },
    codes,
    launcher: routedLauncher(mode, hits),
    logger: createLogger({ level: 'debug', sink: (_level, line) => logs.push(line) }),
    ownerEmail: 'User@Example.com',
    sessions: {
      identity: () => Promise.resolve(options.identity === false ? undefined : FAKE_FINGERPRINT),
      save: (session) => {
        saved.push(session);

        return Promise.resolve();
      },
    },
    // Short, so failing cases end fast; it also keeps the Continue fallback (after 3 s) from firing.
    stepTimeoutMs: options.stepTimeoutMs ?? 3000,
    workspace: { name: "Test User's Notion", url: WORKSPACE_URL },
  });

  return { controller, hits, login, logs, requests, saved };
}

describe('PlaywrightNotionEmailLogin', () => {
  it('signs in with the emailed code and saves the new session with the replayed identity', async () => {
    const { login, logs, requests, saved } = setup('code');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).resolves.toEqual({
      authCookieExpiresAt: '2027-11-05T15:03:59.000Z',
    });
    expect(requests).toEqual([new Date('2026-11-05T15:03:30.000Z')]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ fileHostCookie: true, fingerprint: FAKE_FINGERPRINT });
    expect(saved[0]?.storageState.cookies.map(({ name }) => name).toSorted()).toEqual([
      'file_token',
      'token_v2',
    ]);
    expect(logs.join('\n')).toContain('"stage":"saved"');
    expect(logs.join('\n')).not.toContain(CODE);
  });

  it('clicks Continue once when Enter does not submit the code, then saves the session', async () => {
    // Long enough for the fallback, which waits 3 s after Enter.
    const { hits, login, saved } = setup('enter_ignored', { stepTimeoutMs: 10_000 });

    await expect(login.renewSession(AbortSignal.timeout(30_000))).resolves.toEqual({
      authCookieExpiresAt: '2027-11-05T15:03:59.000Z',
    });
    expect(hits).toContain('app.notion.com/code-submitted');
    expect(hits.filter((hit) => hit === 'app.notion.com/continue-after-code')).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it('stops at a verification page and saves nothing', async () => {
    const { login, saved } = setup('challenge');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).rejects.toMatchObject({
      failure: 'challenge',
    });
    expect(saved).toEqual([]);
  });

  it('stops when Notion asks for a password instead of sending a code', async () => {
    const { login, requests } = setup('password');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).rejects.toMatchObject({
      failure: 'password_prompt',
    });
    expect(requests).toEqual([]);
  });

  it('types nothing once the login leaves Notion, and never asks Gmail for the code', async () => {
    const { login, requests } = setup('leaves_notion');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).rejects.toMatchObject({
      failure: 'ui_changed',
      message: 'The login page left Notion',
    });
    expect(requests).toEqual([]);
  });

  it('keeps the code out of the error when the code field refuses it', async () => {
    const { login, saved } = setup('readonly_code');
    const failure = login.renewSession(AbortSignal.timeout(30_000));

    await expect(failure).rejects.toMatchObject({ failure: 'ui_changed' });

    const error = await failure.catch((error_: unknown) => error_);

    expect(String((error as Error).stack)).not.toContain(CODE);
    expect((error as Error).cause).toBeUndefined();
    expect(saved).toEqual([]);
  });

  it('blocks a move to another site during the fill, so the code never reaches it', async () => {
    const { hits, login, saved } = setup('navigates_during_fill');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).rejects.toMatchObject({
      failure: 'ui_changed',
      message: 'The login page left Notion',
    });
    expect(hits).not.toContain('idp.example.com');
    expect(saved).toEqual([]);
  });

  it('stops at a challenge shown on the login page after the code, without clicking again', async () => {
    const { hits, login, saved } = setup('challenge_after_code');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).rejects.toMatchObject({
      failure: 'challenge',
    });
    expect(hits).not.toContain('app.notion.com/continue-after-code');
    expect(saved).toEqual([]);
  });

  it('sends nothing more once the deadline passes during the code fill', async () => {
    const { controller, hits, login, saved } = setup('slow_fill', { abortAfterCodeMs: 200 });
    const started = performance.now();

    await expect(login.renewSession(controller.signal)).rejects.toThrow('budget');
    expect(hits).not.toContain('app.notion.com/code-submitted');
    expect(saved).toEqual([]);
    // The browser closed at the abort instead of finishing the fill.
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('reports a code that never signs in as not_signed_in', async () => {
    const { login, saved } = setup('never_signs_in');

    await expect(login.renewSession(AbortSignal.timeout(30_000))).rejects.toMatchObject({
      failure: 'not_signed_in',
    });
    expect(saved).toEqual([]);
  });

  it('opens no browser without an identity, or for another mailbox', async () => {
    await expect(
      setup('code', { identity: false }).login.renewSession(AbortSignal.timeout(5000)),
    ).rejects.toMatchObject({ failure: 'no_identity' });
    await expect(
      setup('code', { mailbox: 'other@example.com' }).login.renewSession(AbortSignal.timeout(5000)),
    ).rejects.toMatchObject({ failure: 'owner_mismatch' });
  });
});
