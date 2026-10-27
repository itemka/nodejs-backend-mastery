import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaywrightNotionExportTrigger } from '../../../src/adapters/notion/notion-export-trigger.js';
import type {
  CapturedSession,
  NotionSession,
} from '../../../src/adapters/notion/notion-session.js';
import {
  captureSession,
  sessionCookiesChanged,
} from '../../../src/adapters/notion/notion-session.js';
import { NotionSettingsPage } from '../../../src/adapters/notion/notion-settings-page.js';
import { createLogger } from '../../../src/shared/logger.js';
import { FAKE_FINGERPRINT, fakeNotionBrowser } from '../../support/fake-notion-browser.js';
import { ManualClock } from '../../support/manual-clock.js';

const NOW = new Date('2026-10-26T04:00:00.000Z');
const YEAR_SEC = 365 * 86_400;

function cookie(
  name: string,
  domain: string,
  value: string,
  expiresSec = NOW.getTime() / 1000 + YEAR_SEC,
) {
  return {
    domain,
    expires: expiresSec,
    httpOnly: true,
    name,
    path: '/',
    sameSite: 'Lax' as const,
    secure: true,
    value,
  };
}

const SIGNED_IN = cookie('token_v2', '.app.notion.com', 'v'.repeat(40));
const FILE_TOKEN = cookie('file_token', '.notion.com', 'f'.repeat(40));

function saved(cookies = [SIGNED_IN, FILE_TOKEN]): NotionSession {
  return {
    ...captureSession({ cookies, origins: [] }, FAKE_FINGERPRINT, NOW),
    createdAt: '2026-10-02T10:00:00.000Z',
  };
}

/** A browser whose cookies are now `browserCookies`, with a session store that keeps writes. */
function setupTrigger(
  browserCookies: unknown[],
  options: { failSave?: boolean; session?: NotionSession } = {},
) {
  const saves: CapturedSession[] = [];
  const logs: string[] = [];
  let session = options.session ?? saved();
  const trigger = new PlaywrightNotionExportTrigger({
    clock: new ManualClock(NOW),
    exportFormat: 'markdown',
    launcher: fakeNotionBrowser({
      storageState: { cookies: browserCookies, origins: [] },
      switcherName: 'Test Workspace',
    }),
    logger: createLogger({
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    sessions: {
      load: () => Promise.resolve(session),
      save: (captured) => {
        if (options.failSave === true) {
          return Promise.reject(new Error('Redis unreachable'));
        }

        saves.push(captured);
        session = { ...captured, createdAt: NOW.toISOString() };

        return Promise.resolve();
      },
    },
    workspace: {
      name: 'Test Workspace',
      url: 'https://app.notion.com/p/Dashboard-00000000000000000000000000000000',
    },
  });

  return { logs, saves, trigger };
}

async function probeWith(browserCookies: unknown[], options: { failSave?: boolean } = {}) {
  const setup = setupTrigger(browserCookies, options);

  return { ...setup, probe: await setup.trigger.probeSession() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the export-dialog probe checks the persisted download credential', () => {
  beforeEach(() => {
    vi.spyOn(NotionSettingsPage.prototype, 'open').mockResolvedValue('menu');
    vi.spyOn(NotionSettingsPage.prototype, 'openGeneral').mockResolvedValue();
    vi.spyOn(NotionSettingsPage.prototype, 'openExportDialog').mockResolvedValue('in_progress');
  });

  const expiredFile = { ...FILE_TOKEN, expires: NOW.getTime() / 1000 - 86_400 };
  const oldSession: NotionSession = {
    ...captureSession(
      { cookies: [SIGNED_IN, expiredFile], origins: [] },
      FAKE_FINGERPRINT,
      new Date(NOW.getTime() - 2 * 86_400_000),
    ),
    createdAt: '2026-10-02T10:00:00.000Z',
  };

  it.each([
    ['expired', [SIGNED_IN, expiredFile]],
    ['missing', [SIGNED_IN]],
  ] as const)('rejects recovery when the file cookie is %s', async (_kind, cookies) => {
    const { saves, trigger } = setupTrigger([...cookies], {
      session: {
        ...oldSession,
        storageState: { cookies: [...cookies], origins: [] },
      },
    });

    await expect(trigger.probeExportDialog()).rejects.toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
    });
    expect(saves).toEqual([]);
  });

  it('accepts a renewed file cookie once it was saved, and reports the renewed expiry', async () => {
    const { saves, trigger } = setupTrigger([SIGNED_IN, FILE_TOKEN], {
      session: oldSession,
    });

    await expect(trigger.probeExportDialog()).resolves.toEqual({
      authCookieExpiresAt: saved().authCookieExpiresAt,
      exportDialog: 'in_progress',
    });
    expect(saves).toHaveLength(1);
  });

  it('keeps the login failure when renewing the file cookie could not be saved', async () => {
    const { saves, trigger } = setupTrigger([SIGNED_IN, FILE_TOKEN], {
      failSave: true,
      session: oldSession,
    });

    await expect(trigger.probeExportDialog()).rejects.toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
    });
    expect(saves).toEqual([]);
  });

  it('accepts an already usable saved file cookie without requiring a refresh', async () => {
    const { saves, trigger } = setupTrigger([SIGNED_IN, FILE_TOKEN]);

    await expect(trigger.probeExportDialog()).resolves.toMatchObject({
      exportDialog: 'in_progress',
    });
    expect(saves).toEqual([]);
  });
});

describe('the rolling session refresh', () => {
  it('saves the session again when Notion extended its cookies', async () => {
    const extended = cookie(
      'token_v2',
      '.app.notion.com',
      'w'.repeat(40),
      NOW.getTime() / 1000 + 2 * YEAR_SEC,
    );
    const { logs, probe, saves } = await probeWith([
      extended,
      FILE_TOKEN,
      cookie('_ga', '.example.com', 'x'),
    ]);

    expect(probe.state).toBe('valid');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.storageState.cookies.map(({ name }) => name)).toEqual([
      'token_v2',
      'file_token',
    ]);
    expect(saves[0]?.fingerprint).toEqual(FAKE_FINGERPRINT);
    expect(saves[0]?.authCookieExpiresAt).toBe(
      new Date(NOW.getTime() + YEAR_SEC * 1000).toISOString(),
    );
    expect(logs.join('\n')).toContain('notion.session.refreshed');
    expect(logs.join('\n')).not.toContain('w'.repeat(40));
  });

  it('keeps the saved session when nothing changed, or the file host’s cookie is gone', async () => {
    await expect(probeWith([FILE_TOKEN, SIGNED_IN])).resolves.toMatchObject({ saves: [] });
    await expect(
      probeWith([cookie('token_v2', '.app.notion.com', 'n'.repeat(40))]),
    ).resolves.toMatchObject({ saves: [] });
  });

  it('never fails the call when the write-back fails or the browser lost the sign-in', async () => {
    const changed = [cookie('token_v2', '.app.notion.com', 'n'.repeat(40)), FILE_TOKEN];
    const failedSave = await probeWith(changed, { failSave: true });
    const signedOut = await probeWith([FILE_TOKEN]);

    expect(failedSave.probe.state).toBe('valid');
    expect(failedSave.logs.join('\n')).toContain('notion.session.refresh_failed');
    expect(signedOut.probe.state).toBe('valid');
    expect(signedOut.logs.join('\n')).toContain('"reason":"NOTION_SESSION_EXPIRED"');
  });
});

describe('sessionCookiesChanged', () => {
  it('compares values, expiries and the set of cookies, not their order', () => {
    const base = saved().storageState;

    expect(sessionCookiesChanged(base, { ...base, cookies: base.cookies.toReversed() })).toBe(
      false,
    );
    expect(
      sessionCookiesChanged(base, { ...base, cookies: [SIGNED_IN, { ...FILE_TOKEN, expires: 1 }] }),
    ).toBe(true);
    expect(sessionCookiesChanged(base, { ...base, cookies: [SIGNED_IN] })).toBe(true);
  });
});
