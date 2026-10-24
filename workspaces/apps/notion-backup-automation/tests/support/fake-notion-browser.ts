import type { Browser } from 'playwright-core';

import type { BrowserLauncher, LaunchOptions } from '../../src/adapters/notion/browser-launcher.js';
import type { BrowserFingerprint } from '../../src/adapters/notion/notion-session.js';

export const FAKE_FINGERPRINT: BrowserFingerprint = {
  locale: 'en-US',
  timezoneId: 'Europe/Warsaw',
  userAgent: 'Mozilla/5.0 Chrome/141.0.0.0',
  viewport: { height: 900, width: 1440 },
};

export interface FakeNotionBrowser extends BrowserLauncher {
  /** Each launch's options, in order. */
  readonly launches: LaunchOptions[];
}

/**
 * Just enough of Playwright's browser for `auth:notion`, with no real browser: the login page
 * signs in at once, as if you had, every page shows the app with a switcher named
 * `switcherName`, and each context's `storageState()` is `storageState`.
 */
export function fakeNotionBrowser({
  storageState,
  switcherName,
}: {
  storageState: unknown;
  switcherName: string;
}): FakeNotionBrowser {
  const launches: LaunchOptions[] = [];

  function newPage() {
    let url = 'about:blank';

    const switcher = (name: RegExp) => {
      const locator = {
        filter: () => locator,
        first: () => locator,
        waitFor: () =>
          name.test(switcherName)
            ? Promise.resolve()
            : Promise.reject(new Error('No switcher with this name')),
      };

      return locator;
    };

    return Promise.resolve({
      evaluate: () => Promise.resolve(FAKE_FINGERPRINT),
      getByRole: (_role: string, { name }: { name: RegExp }) => switcher(name),
      goto: (target: string) => {
        url = target.endsWith('/login') ? 'https://app.notion.com/' : target;

        return Promise.resolve({ status: () => 200 });
      },
      isClosed: () => false,
      locator: (selector: string) => ({
        first: () => ({ isVisible: () => Promise.resolve(selector.includes('notion-sidebar')) }),
      }),
      setDefaultTimeout: () => {
        // Nothing here waits.
      },
      title: () => Promise.resolve('Dashboard | Notion'),
      url: () => url,
    });
  }

  const browser = {
    close: () => Promise.resolve(),
    newContext: () =>
      Promise.resolve({ newPage, storageState: () => Promise.resolve(storageState) }),
  };

  return {
    launch: (options) => {
      launches.push(options);

      return Promise.resolve(browser as unknown as Browser);
    },
    launches,
  };
}
