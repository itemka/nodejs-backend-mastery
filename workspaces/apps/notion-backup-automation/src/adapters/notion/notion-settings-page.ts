import type { Locator, Page } from 'playwright-core';

import { IntegrationError } from '../../application/integration-error.js';
import type { NotionExportFormat } from '../../config/env.js';

/**
 * The texts the page object finds things by, as recorded in Phase 0 (Step 1) and by the S2
 * probe: Workspace switcher → Settings → General → Export → "Workspace content" → Export.
 */
export const NOTION_SETTINGS = {
  cancel: 'Cancel',
  export: 'Export',
  exportRow: 'Workspace content',
  general: 'General',
  /** The second Export row, disabled on the Free plan; never clicked. */
  membersRow: 'Members',
  /** Two settings tabs that only the Settings navigation holds together. */
  navigation: ['Preferences', 'People'],
  settings: 'Settings',
} as const;

/** The export dialog's four values (Phase 0). The run never exports with other ones. */
export const EXPORT_DIALOG = {
  createFolders: 'Create folders for subpages',
  databaseViews: { label: 'Database views', value: 'Current view' },
  format: 'Export format',
  pageContent: { label: 'Page content', value: 'Everything' },
} as const;

export const exportFormatLabels = {
  markdown: 'Markdown & CSV',
} as const satisfies Record<NotionExportFormat, string>;

/** "Exporting...", and "We'll also send you an email with the download link." (Phase 0). */
const exportProgress = /^Exporting|send you an email with the download link/;

const CONTROL = 'button, [role="button"]';
const TOGGLE = '[role="switch"], [role="checkbox"], input[type="checkbox"]';
const TOGGLE_ON =
  '[role="switch"][aria-checked="true"], [role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked';

export interface NotionSettingsPageOptions {
  /** The wait for each element; S2 needed up to 17 s for one step on Vercel. */
  readonly stepTimeoutMs: number;
  /** The visible workspace switcher the session gate found. */
  readonly workspaceSwitcher: Locator;
}

/**
 * Notion's Settings, found by role and text and never by position. Opening the export dialog
 * does not start an export: only a click on the dialog's own Export button does, and this class
 * never makes it. A step whose element does not appear in time throws `NOTION_UI_CHANGED`
 * naming the step.
 */
export class NotionSettingsPage {
  private readonly page: Page;
  private readonly stepTimeoutMs: number;
  private readonly workspaceSwitcher: Locator;

  constructor(page: Page, { stepTimeoutMs, workspaceSwitcher }: NotionSettingsPageOptions) {
    this.page = page;
    this.stepTimeoutMs = stepTimeoutMs;
    this.workspaceSwitcher = workspaceSwitcher;
  }

  /** Opens Settings from the workspace menu, or else with the keyboard shortcut (S2). */
  async open(): Promise<'menu' | 'shortcut'> {
    const { page } = this;
    const preferences = page.getByText(NOTION_SETTINGS.navigation[0], { exact: true }).first();

    return uiStep('open-settings', async () => {
      try {
        await this.workspaceSwitcher.click({ timeout: this.stepTimeoutMs });
        await page
          .getByRole('menuitem', { exact: true, name: NOTION_SETTINGS.settings })
          .or(page.getByText(NOTION_SETTINGS.settings, { exact: true }))
          .first()
          .click({ timeout: this.stepTimeoutMs });
        await preferences.waitFor({ timeout: this.stepTimeoutMs / 2 });

        return 'menu';
      } catch {
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+Comma');
        await preferences.waitFor({ timeout: this.stepTimeoutMs });

        return 'shortcut';
      }
    });
  }

  async openGeneral(): Promise<void> {
    const { page } = this;
    const [first, second] = NOTION_SETTINGS.navigation;

    await uiStep('open-general', async () => {
      // The Settings navigation is the innermost element that holds both tabs.
      const navigation = page
        .locator('div')
        .filter({ has: page.getByText(first, { exact: true }) })
        .filter({ has: page.getByText(second, { exact: true }) })
        .last();

      await navigation
        .getByText(NOTION_SETTINGS.general, { exact: true })
        .first()
        .click({ timeout: this.stepTimeoutMs });
      await page
        .getByText(NOTION_SETTINGS.exportRow, { exact: true })
        .first()
        .waitFor({ timeout: this.stepTimeoutMs });
    });
  }

  /**
   * Clicks the "Workspace content" row's Export, which opens the options dialog. Returns
   * `in_progress` instead when Notion shows an export already running.
   */
  async openExportDialog(): Promise<ExportDialog | 'in_progress'> {
    const { page } = this;
    const exportControl = page
      .getByRole('button', { exact: true, name: NOTION_SETTINGS.export })
      .or(page.getByText(NOTION_SETTINGS.export, { exact: true }));
    // The Members row has its own Export button, so the row must not hold "Members".
    const row = page
      .locator('div')
      .filter({ has: page.getByText(NOTION_SETTINGS.exportRow, { exact: true }) })
      .filter({ has: exportControl.or(page.getByText(exportProgress)) })
      .filter({ hasNotText: NOTION_SETTINGS.membersRow })
      .last();

    return uiStep('open-export-dialog', async () => {
      await row.waitFor({ timeout: this.stepTimeoutMs });

      if (await row.getByText(exportProgress).first().isVisible()) {
        return 'in_progress';
      }

      await control(row, NOTION_SETTINGS.export).click({ timeout: this.stepTimeoutMs });

      const format = page.getByText(EXPORT_DIALOG.format, { exact: true }).first();
      const progress = page.getByText(exportProgress).first();

      await format.or(progress).first().waitFor({ timeout: this.stepTimeoutMs });

      if (await progress.isVisible()) {
        return 'in_progress';
      }

      const root = page
        .locator('div')
        .filter({ has: page.getByText(EXPORT_DIALOG.format, { exact: true }) })
        .filter({ has: page.getByText(NOTION_SETTINGS.cancel, { exact: true }) })
        .last();

      return new ExportDialog(page, root, this.stepTimeoutMs);
    });
  }
}

/** The "Workspace content" export dialog. */
export class ExportDialog {
  private readonly page: Page;
  private readonly root: Locator;
  private readonly stepTimeoutMs: number;

  constructor(page: Page, root: Locator, stepTimeoutMs: number) {
    this.page = page;
    this.root = root;
    this.stepTimeoutMs = stepTimeoutMs;
  }

  /**
   * Sets each of the four values to Phase 0's where it differs, and returns the labels of the
   * ones it changed. A value that cannot be set is `NOTION_UI_CHANGED`.
   */
  async applySettings(format: NotionExportFormat): Promise<string[]> {
    const choices = [
      { label: EXPORT_DIALOG.format, value: exportFormatLabels[format] },
      EXPORT_DIALOG.databaseViews,
      EXPORT_DIALOG.pageContent,
    ];
    const changed: string[] = [];

    for (const { label, value } of choices) {
      if (await uiStep(`set ${label}`, () => this.choose(label, value))) {
        changed.push(label);
      }
    }

    if (await uiStep(`set ${EXPORT_DIALOG.createFolders}`, () => this.switchOn())) {
      changed.push(EXPORT_DIALOG.createFolders);
    }

    return changed;
  }

  /** Clicks Cancel, or presses Escape, until the dialog is gone. */
  async cancel(): Promise<void> {
    const format = this.page.getByText(EXPORT_DIALOG.format, { exact: true }).first();

    await uiStep('cancel-dialog', async () => {
      try {
        await control(this.root, NOTION_SETTINGS.cancel).click({ timeout: this.stepTimeoutMs / 2 });
        await format.waitFor({ state: 'hidden', timeout: this.stepTimeoutMs / 2 });
      } catch {
        await this.page.keyboard.press('Escape');
        await format.waitFor({ state: 'hidden', timeout: this.stepTimeoutMs });
      }
    });
  }

  /**
   * The dialog's own Export button, without clicking it: exactly one, enabled. By role, or by
   * its exact text when no element has the role.
   */
  async exportButton(): Promise<Locator> {
    return uiStep('find-export-button', async () => {
      await this.root.waitFor({ timeout: this.stepTimeoutMs });

      const byRole = this.root.getByRole('button', { exact: true, name: NOTION_SETTINGS.export });
      const candidates =
        (await byRole.count()) > 0
          ? byRole
          : this.root.getByText(NOTION_SETTINGS.export, { exact: true });

      if ((await candidates.count()) !== 1 || !(await candidates.isEnabled())) {
        throw new IntegrationError(
          'NOTION_UI_CHANGED',
          'The export dialog does not hold exactly one enabled Export button',
        );
      }

      return candidates;
    });
  }

  /** Picks `value` from the row's menu unless the row shows it already. */
  private async choose(label: string, value: string): Promise<boolean> {
    const { page } = this;
    const row = this.row(label, page.locator(CONTROL));
    const current = row.getByText(value, { exact: true }).first();

    await row.waitFor({ timeout: this.stepTimeoutMs });

    if (await current.isVisible()) {
      return false;
    }

    await row.locator(CONTROL).last().click({ timeout: this.stepTimeoutMs });
    await page
      .getByRole('menuitem', { exact: true, name: value })
      .or(page.getByRole('option', { exact: true, name: value }))
      .or(page.getByText(value, { exact: true }))
      .filter({ visible: true })
      .first()
      .click({ timeout: this.stepTimeoutMs });
    await current.waitFor({ timeout: this.stepTimeoutMs });

    return true;
  }

  /** The innermost element that holds the label and a control: the label's row. */
  private row(label: string, withControl: Locator): Locator {
    return this.root
      .locator('div')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .filter({ has: withControl })
      .last();
  }

  /** Turns "Create folders for subpages" on unless it is on. */
  private async switchOn(): Promise<boolean> {
    const row = this.row(EXPORT_DIALOG.createFolders, this.page.locator(TOGGLE));
    const toggle = row.locator(TOGGLE).first();

    await toggle.waitFor({ timeout: this.stepTimeoutMs });

    if (await toggle.isChecked()) {
      return false;
    }

    await toggle.click({ timeout: this.stepTimeoutMs });
    await row.locator(TOGGLE_ON).first().waitFor({ timeout: this.stepTimeoutMs });

    return true;
  }
}

/** After the final click: whether Notion shows its "Exporting" message within `timeoutMs`. */
export async function waitForExportProgress(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.getByText(exportProgress).first().waitFor({ timeout: timeoutMs });

    return true;
  } catch {
    return false;
  }
}

/** The exact-name button, or the exact text when Notion renders a plain element (S2). */
function control(scope: Locator, name: string): Locator {
  return scope
    .getByRole('button', { exact: true, name })
    .or(scope.getByText(name, { exact: true }))
    .first();
}

/** A Playwright wait that ran out of time means an expected element is missing. */
async function uiStep<T>(step: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new IntegrationError(
        'NOTION_UI_CHANGED',
        `The Notion Settings step "${step}" found no matching element`,
      );
    }

    throw error;
  }
}
