import * as ui from '@workspaces/cli-output';

import { PlaywrightNotionExportTrigger } from '../../adapters/notion/notion-export-trigger.js';
import type { ExportTriggerOutcome } from '../../application/ports.js';
import { loadEnv, notionBrowserEnvSchema } from '../../config/env.js';
import type { CliContext } from '../context.js';
import { createNotionSessions } from '../context.js';

export interface DevTriggerOptions {
  dryRun: boolean;
  headed: boolean;
}

const outcomeText: Record<ExportTriggerOutcome, string> = {
  already_in_progress: 'Notion shows an export already running; nothing was clicked.',
  confirmed: 'Notion confirmed the export ("Exporting").',
  in_doubt:
    'The final Export was clicked, but no confirmation appeared. Wait for the email before running dev:trigger again.',
};

/**
 * `dev:trigger [--dry-run] [--headed]`: the Notion side of a backup, run locally with the dev
 * session. It runs only with `APP_ENV=dev`. A real run requests one official workspace export,
 * so Notion sends its export email; `--dry-run` stops at the dialog's Export button.
 */
export async function runDevTrigger(
  options: DevTriggerOptions,
  context: CliContext,
): Promise<number> {
  const env = loadEnv(notionBrowserEnvSchema, context.env);

  if (env.APP_ENV !== 'dev') {
    context.print(
      ui.fail('dev:trigger uses the dev Notion session only: run it with APP_ENV=dev.'),
    );

    return 1;
  }

  const trigger = new PlaywrightNotionExportTrigger({
    clock: context.clock,
    exportFormat: env.NOTION_EXPORT_FORMAT,
    headless: !options.headed,
    launcher: context.browserLauncher,
    logger: context.logger,
    sessions: createNotionSessions(context, env),
    workspace: { name: env.NOTION_WORKSPACE_NAME, url: env.NOTION_WORKSPACE_URL },
  });

  if (options.dryRun) {
    context.print(ui.heading('Notion export (dry run)'));

    const rehearsal = await trigger.rehearseExport();

    if (rehearsal.outcome === 'in_progress') {
      context.print(ui.ok(outcomeText.already_in_progress));

      return 0;
    }

    const dialogValues =
      rehearsal.changed.length === 0 ? 'all as expected' : `set: ${rehearsal.changed.join(', ')}`;

    context.print(ui.ok('Reached the export dialog and cancelled it; nothing was exported.'));
    context.print(`  Settings opened by  ${rehearsal.settingsOpenedBy}`);
    context.print(`  dialog values       ${dialogValues}`);
    context.print('  Export button       found, not clicked');

    return 0;
  }

  context.print(ui.heading('Notion export'));

  const { outcome } = await trigger.requestExport({
    onBeforeFinalClick: () => {
      context.print(`Clicking Export at ${context.clock.now().toISOString()}`);

      return Promise.resolve();
    },
  });

  if (outcome === 'in_doubt') {
    context.print(ui.warn(outcomeText.in_doubt));

    return 1;
  }

  context.print(ui.ok(outcomeText[outcome]));
  context.print(
    'The export email usually arrives 3 to 10 minutes later. Then check the download with APP_ENV=dev … cli dev:download.',
  );

  return 0;
}
