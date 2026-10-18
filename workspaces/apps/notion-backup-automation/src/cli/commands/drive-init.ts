import * as ui from '@workspaces/cli-output';

import {
  APP_OWNED_ROOT_NAME,
  ensureAppOwnedRoot,
} from '../../adapters/drive/drive-access-check.js';
import { googleApiEnvSchema, loadEnv } from '../../config/env.js';
import type { CliContext } from '../context.js';
import { createGoogleApi, createTokenProvider } from '../context.js';

/**
 * `drive:init`: S6 fallback 2. Creates the app-owned root folder, or finds the one created
 * before. Moving it into place and updating the config stay manual.
 */
export async function runDriveInit(context: CliContext): Promise<number> {
  const env = loadEnv(googleApiEnvSchema, context.env);
  const api = createGoogleApi(context, 'drive', createTokenProvider(context, env));
  const root = await ensureAppOwnedRoot(api);

  context.print(
    ui.ok(
      root.created
        ? `Created the app-owned "${APP_OWNED_ROOT_NAME}" folder at the top of My Drive.`
        : `The app-owned "${APP_OWNED_ROOT_NAME}" folder already exists.`,
    ),
  );
  context.print(`  folder ID  ${root.folderId}`);
  context.print(ui.heading('Next'));
  context.print('  1. In Drive, move it under Backups/Notion/. Rename your own folder to');
  context.print(`     "${APP_OWNED_ROOT_NAME} (manual)", or move its ZIPs into the new one.`);
  context.print('  2. Set GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID to this ID in 1Password, .env.local');
  context.print('     and Vercel.');
  context.print('  3. Run drive:check.');

  return 0;
}
