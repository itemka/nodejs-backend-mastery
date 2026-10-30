import { describe, expect, it } from 'vitest';

import { LocalBrowserLauncher } from '../../src/adapters/notion/browser-launcher.js';
import { PlaywrightNotionExportTrigger } from '../../src/adapters/notion/notion-export-trigger.js';
import type { NotionSession } from '../../src/adapters/notion/notion-session.js';
import type { IntegrationError } from '../../src/application/integration-error.js';
import { createLogger } from '../../src/shared/logger.js';
import type { WorkspaceOptions } from '../support/notion-ui.js';
import { NotionUi } from '../support/notion-ui.js';

const SESSION: NotionSession = {
  authCookieExpiresAt: '2027-10-02T00:00:00.000Z',
  createdAt: '2026-10-22T10:00:00.000Z',
  fileHostCookie: true,
  fingerprint: {
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    viewport: { height: 900, width: 1440 },
  },
  storageState: {
    cookies: ['token_v2', 'file_token'].map((name) => ({
      domain: name === 'token_v2' ? '.app.notion.com' : '.notion.com',
      expires: Date.parse('2027-10-02T00:00:00.000Z') / 1000,
      httpOnly: true,
      name,
      path: '/',
      sameSite: 'Lax' as const,
      secure: true,
      value: 'fake-browser-fixture-cookie',
    })),
    origins: [],
  },
};

/** The values every export must use. */
const EXPECTED_EXPORT = {
  content: 'Everything',
  folders: true,
  format: 'Markdown & CSV',
  privatePages: true,
  views: 'Current view',
};

const launcher = new LocalBrowserLauncher();

async function setup(workspace: string | WorkspaceOptions = {}, stepTimeoutMs = 3000) {
  const ui = await NotionUi.start();
  const logs: string[] = [];
  const trigger = new PlaywrightNotionExportTrigger({
    clock: { now: () => new Date('2026-10-26T04:00:00.000Z') },
    exportFormat: 'markdown',
    launcher,
    logger: createLogger({
      level: 'debug',
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    sessions: { load: () => Promise.resolve(SESSION), save: () => Promise.resolve() },
    stepTimeoutMs,
    workspace: {
      // The configured name has a straight apostrophe; the fixture shows ’ (Phase 0).
      name: "Test User's Notion",
      url: typeof workspace === 'string' ? ui.url(workspace) : ui.workspaceUrl(workspace),
    },
  });

  const beforeClick = () => {
    ui.events.push('before-click');

    return Promise.resolve();
  };

  return { beforeClick, logs, trigger, ui };
}

describe('probeSession', () => {
  it('passes a signed-in workspace and reports the cookie expiry', async () => {
    const { trigger, ui } = await setup();

    await expect(trigger.probeSession()).resolves.toEqual({
      authCookieExpiresAt: SESSION.authCookieExpiresAt,
      state: 'valid',
    });
    expect(ui.exports).toEqual([]);
  });

  it.each([
    ['/p/signed-out', 'NOTION_SESSION_EXPIRED'],
    ['/p/challenge', 'NOTION_INTERACTIVE_CHALLENGE'],
    ['/p/down', 'NOTION_UNAVAILABLE'],
    ['/p/loading', 'NOTION_UNAVAILABLE'],
  ])('reports %s as %s', async (pathname, code) => {
    const { trigger } = await setup(pathname, 1500);

    await expect(trigger.probeSession()).rejects.toMatchObject({ code });
  });

  it.each(['Someone Else’s Notion', 'Test User’s Notion Archive', 'A Test User’s Notion'])(
    'reports %s as NOTION_WRONG_WORKSPACE',
    async (name) => {
      const { trigger } = await setup({ name }, 1500);

      await expect(trigger.probeSession()).rejects.toMatchObject({
        code: 'NOTION_WRONG_WORKSPACE',
      });
    },
  );

  it('passes a switcher that shows the avatar initial before the name', async () => {
    const { trigger } = await setup({ name: 'T Test User’s Notion' });

    await expect(trigger.probeSession()).resolves.toMatchObject({ state: 'valid' });
  });

  it('ends at once with the reason when the signal aborts', async () => {
    const { trigger } = await setup('/p/loading', 30_000);
    const started = performance.now();

    await expect(trigger.probeSession(AbortSignal.timeout(500))).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe('rehearseExport', () => {
  it('reaches the dialog, finds its Export button, and cancels without exporting', async () => {
    const { trigger, ui } = await setup();

    await expect(trigger.rehearseExport()).resolves.toEqual({
      changed: [],
      outcome: 'dialog_ready',
      settingsOpenedBy: 'menu',
    });
    expect(ui.exports).toEqual([]);
  });

  it('opens Settings with the shortcut when the menu has no Settings item', async () => {
    const { trigger, ui } = await setup({ broken: ['settings-menu'] });

    await expect(trigger.rehearseExport()).resolves.toMatchObject({ settingsOpenedBy: 'shortcut' });
    expect(ui.exports).toEqual([]);
  });
});

describe('probeExportDialog', () => {
  it('reaches the export dialog and cancels it, with the sign-in’s expiry', async () => {
    const { trigger, ui } = await setup();

    await expect(trigger.probeExportDialog()).resolves.toEqual({
      authCookieExpiresAt: SESSION.authCookieExpiresAt,
      exportDialog: 'ready',
    });
    expect(ui.exports).toEqual([]);
  });

  it('reports a changed Settings page as NOTION_UI_CHANGED, without exporting', async () => {
    const { trigger, ui } = await setup({ broken: ['general'] }, 1500);

    await expect(trigger.probeExportDialog()).rejects.toMatchObject({ code: 'NOTION_UI_CHANGED' });
    expect(ui.exports).toEqual([]);
  });

  it('attaches the Settings dialog’s ARIA landmarks to NOTION_UI_CHANGED, never the page’s', async () => {
    const { trigger } = await setup({ broken: ['general'] }, 1500);
    const failure = await uiFailure(trigger);

    expect(failure.code).toBe('NOTION_UI_CHANGED');
    expect(failure.uiLandmarks).toEqual(['dialog:Settings', 'tab:Preferences', 'tab:People']);
  });

  it('attaches no landmarks when Settings never opened: the page is not read', async () => {
    const { trigger } = await setup({ broken: ['settings'] }, 1500);
    const failure = await uiFailure(trigger);

    expect(failure.code).toBe('NOTION_UI_CHANGED');
    expect(failure.uiLandmarks ?? []).toEqual([]);
    expect(JSON.stringify(failure)).not.toMatch(/Private roadmap|Test User/);
  });
});

async function uiFailure(trigger: PlaywrightNotionExportTrigger): Promise<IntegrationError> {
  try {
    await trigger.probeExportDialog();
  } catch (error) {
    return error as IntegrationError;
  }

  throw new Error('probeExportDialog did not fail');
}

describe('requestExport', () => {
  it('exports with the expected values and calls onBeforeFinalClick before the click', async () => {
    const { beforeClick, trigger, ui } = await setup();

    await expect(trigger.requestExport({ onBeforeFinalClick: beforeClick })).resolves.toEqual({
      outcome: 'confirmed',
    });
    expect(ui.exports).toEqual([EXPECTED_EXPORT]);
    expect(ui.events).toEqual(['before-click', 'export']);
  });

  it('sets every dialog value that differs before it exports', async () => {
    const { beforeClick, logs, trigger, ui } = await setup({
      content: 'No files or images',
      folders: false,
      format: 'HTML',
      privatePages: false,
      views: 'Default view',
    });

    await expect(trigger.requestExport({ onBeforeFinalClick: beforeClick })).resolves.toEqual({
      outcome: 'confirmed',
    });
    expect(ui.exports).toEqual([EXPECTED_EXPORT]);
    expect(logs.join('\n')).toContain(
      '"changed":["Export format","Database views","Page content","Include private pages","Create folders for subpages"]',
    );
  });

  it('never exports when the private pages toggle is missing', async () => {
    const { beforeClick, trigger, ui } = await setup({ broken: ['private-pages'] }, 1500);

    await expect(trigger.requestExport({ onBeforeFinalClick: beforeClick })).rejects.toMatchObject({
      code: 'NOTION_UI_CHANGED',
      message: 'The Notion Settings step "set Include private pages" found no matching element',
    });
    expect(ui.exports).toEqual([]);
    expect(ui.events).toEqual([]);
  });

  it('never exports when a value cannot be set, after one reload', async () => {
    const { logs, trigger, ui } = await setup({ broken: ['format'], format: 'PDF' }, 1500);
    let called = false;

    await expect(
      trigger.requestExport({
        onBeforeFinalClick: () => {
          called = true;

          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({
      code: 'NOTION_UI_CHANGED',
      message: 'The Notion Settings step "set Export format" found no matching element',
    });
    expect(called).toBe(false);
    expect(ui.exports).toEqual([]);
    expect(ui.workspaceLoads).toBe(2);
    expect(logs.join('\n')).toContain('"event":"notion.ui.retry"');
  });

  it('recovers from a UI failure with one reload', async () => {
    const { beforeClick, trigger, ui } = await setup(
      { broken: ['general'], brokenOnFirstLoad: true },
      1500,
    );

    await expect(trigger.requestExport({ onBeforeFinalClick: beforeClick })).resolves.toEqual({
      outcome: 'confirmed',
    });
    expect(ui.workspaceLoads).toBe(2);
    expect(ui.exports).toEqual([EXPECTED_EXPORT]);
  });

  it('reports an export already running without clicking', async () => {
    const { beforeClick, trigger, ui } = await setup({ state: 'exporting' });

    await expect(trigger.requestExport({ onBeforeFinalClick: beforeClick })).resolves.toEqual({
      outcome: 'already_in_progress',
    });
    expect(ui.events).toEqual([]);
  });

  it('returns in_doubt, not an error, when no confirmation follows the click', async () => {
    const { beforeClick, trigger, ui } = await setup({ confirm: 'none' }, 1500);

    await expect(trigger.requestExport({ onBeforeFinalClick: beforeClick })).resolves.toEqual({
      outcome: 'in_doubt',
    });
    expect(ui.events).toEqual(['before-click', 'export']);
  });

  it('does not click when onBeforeFinalClick rejects', async () => {
    const { trigger, ui } = await setup();
    const failure = new Error('compare-and-set conflict');

    await expect(
      trigger.requestExport({ onBeforeFinalClick: () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
    expect(ui.exports).toEqual([]);
  });

  it('rejects at once and never clicks when the signal aborts during onBeforeFinalClick', async () => {
    const { trigger, ui } = await setup();
    const controller = new AbortController();
    const reason = new Error('tick budget spent');
    const pending = Promise.withResolvers<void>();

    await expect(
      trigger.requestExport({
        onBeforeFinalClick: () => {
          controller.abort(reason);

          return pending.promise;
        },
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);

    pending.resolve();
    expect(ui.events).toEqual([]);
    expect(ui.exports).toEqual([]);
  });

  it('never clicks when the signal aborts as onBeforeFinalClick resolves', async () => {
    const { trigger, ui } = await setup();
    const controller = new AbortController();
    const reason = new Error('tick budget spent');

    await expect(
      trigger.requestExport({
        onBeforeFinalClick: () => {
          controller.abort(reason);

          return Promise.resolve();
        },
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(ui.exports).toEqual([]);
  });
});
