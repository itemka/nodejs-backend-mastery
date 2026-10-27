import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser, LaunchOptions } from 'playwright-core';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { ServerlessChromium } from '../../../src/adapters/notion/browser-launcher.js';
import {
  createBrowserLauncher,
  LocalBrowserLauncher,
  ServerlessBrowserLauncher,
} from '../../../src/adapters/notion/browser-launcher.js';
import { IntegrationError } from '../../../src/application/integration-error.js';

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'nba-chromium-'));

  onTestFinished(() => rm(directory, { force: true, recursive: true }));

  return directory;
}

function fakeChromium(): ServerlessChromium {
  return {
    args: [
      '--allow-running-insecure-content',
      '--disable-site-isolation-trials',
      '--disable-web-security',
      '--headless=shell',
      '--single-process',
    ],
    executablePath: () => Promise.resolve("/tmp/chromium's/chromium"),
    setGraphicsMode: true,
  };
}

/** A browser that remembers its `disconnected` listener, so a test can close it. */
function fakeBrowser() {
  let onDisconnected: (() => void) | undefined;
  const browser = {
    on: (event: string, listener: () => void) => {
      if (event === 'disconnected') {
        onDisconnected = listener;
      }

      return browser;
    },
  };

  return { browser: browser as unknown as Browser, disconnect: () => onDisconnected?.() };
}

/** Chromium that does not start, as on a missing system library. */
function failingLaunch(): Promise<Browser> {
  return Promise.reject(new Error('libnss3.so: missing'));
}

describe('ServerlessBrowserLauncher', () => {
  it('launches headless Chromium with web security on, through a no-core-dump wrapper', async () => {
    const directory = await tempDirectory();
    const chromium = fakeChromium();
    const launches: LaunchOptions[] = [];
    const { browser } = fakeBrowser();

    const launch = (options: LaunchOptions): Promise<Browser> => {
      launches.push(options);

      return Promise.resolve(browser);
    };

    const launcher = new ServerlessBrowserLauncher({
      loadChromium: () => Promise.resolve(chromium),
      loadLaunch: () => Promise.resolve(launch),
      tmpDirectory: directory,
    });

    await expect(launcher.launch()).resolves.toBe(browser);

    const wrapper = path.join(directory, 'chromium-no-core.sh');

    expect(chromium.setGraphicsMode).toBe(false);
    expect(launches).toEqual([
      {
        args: ['--headless=shell', '--single-process'],
        executablePath: wrapper,
        headless: true,
      },
    ]);
    await expect(readFile(wrapper, 'utf8')).resolves.toBe(
      `#!/bin/sh\nulimit -c 0\nexec '/tmp/chromium'\\''s/chromium' "$@"\n`,
    );
    const { mode } = await stat(wrapper);

    expect(mode & 0o777).toBe(0o700);
  });

  it('deletes core dumps before the launch and when the browser closes', async () => {
    const directory = await tempDirectory();
    const { browser, disconnect } = fakeBrowser();
    const launch = (): Promise<Browser> => Promise.resolve(browser);
    const launcher = new ServerlessBrowserLauncher({
      loadChromium: () => Promise.resolve(fakeChromium()),
      loadLaunch: () => Promise.resolve(launch),
      tmpDirectory: directory,
    });

    await writeFile(path.join(directory, 'core.chromium.17'), 'session memory');
    await writeFile(path.join(directory, 'keep.zip.part'), 'not a dump');
    await launcher.launch();
    const names = await readdir(directory);

    expect(names.toSorted()).toEqual(['chromium-no-core.sh', 'keep.zip.part']);

    await writeFile(path.join(directory, 'core'), 'session memory');
    disconnect();
    await expect.poll(() => readdir(directory)).not.toContain('core');
  });

  it('reports a failed start as BROWSER_LAUNCH_FAILED, without its details', async () => {
    const launcher = new ServerlessBrowserLauncher({
      loadChromium: () => Promise.resolve(fakeChromium()),
      loadLaunch: () => Promise.resolve(failingLaunch),
      tmpDirectory: await tempDirectory(),
    });
    const failure = launcher.launch();

    await expect(failure).rejects.toBeInstanceOf(IntegrationError);
    await expect(failure).rejects.toMatchObject({
      code: 'BROWSER_LAUNCH_FAILED',
      message: 'Serverless Chromium did not start',
    });
  });
});

describe('createBrowserLauncher', () => {
  it('uses serverless Chromium on Vercel and your Chrome elsewhere', () => {
    expect(createBrowserLauncher({ VERCEL: '1' })).toBeInstanceOf(ServerlessBrowserLauncher);
    expect(createBrowserLauncher({})).toBeInstanceOf(LocalBrowserLauncher);
  });
});
