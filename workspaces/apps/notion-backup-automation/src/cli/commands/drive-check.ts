import * as ui from '@workspaces/cli-output';

import type { DriveCheck, DriveCheckId } from '../../adapters/drive/drive-access-check.js';
import { checkDriveAccess } from '../../adapters/drive/drive-access-check.js';
import { driveEnvSchema, loadEnv } from '../../config/env.js';
import { periodFor, yearOfPeriod } from '../../domain/period.js';
import type { CliContext } from '../context.js';
import { createGoogleApi, createTokenProvider } from '../context.js';

/**
 * `drive:check`: the S6 checks C1–C4 with the real token. Exits 0 when the app can use the root
 * (C1 and C3); the verdict line says which S6 outcome applies.
 */
export async function runDriveCheck(
  options: { year: string | undefined },
  context: CliContext,
): Promise<number> {
  const env = loadEnv(driveEnvSchema, context.env);
  const year = options.year ?? yearOfPeriod(periodFor(context.clock.now(), env.BACKUP_TIME_ZONE));
  const api = createGoogleApi(context, 'drive', createTokenProvider(context, env));
  const report = await checkDriveAccess({
    api,
    rootFolderId: env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID,
    year,
  });

  context.print(ui.heading(`Drive access check (S6), year folder ${year}`));

  for (const check of report.checks) {
    context.print(formatCheck(check));
  }

  for (const id of report.leftoverProbeIds) {
    context.print(ui.warn(`Delete the leftover probe file ${id} in Drive.`));
  }

  const passed = (id: DriveCheckId) =>
    report.checks.some((check) => check.id === id && check.outcome === 'pass');

  if (passed('C1') && passed('C2') && passed('C3') && passed('C4')) {
    context.print(
      ui.ok('All checks pass: use the existing root and year folder (mode "existing").'),
    );

    return 0;
  }

  if (passed('C1') && passed('C3')) {
    context.print(
      ui.warn(
        `The root works, but your ${year} folder does not. The app will create its own ${year} folder: rename yours to "${year} (manual)" and move its ZIPs into the new one.`,
      ),
    );

    return 0;
  }

  context.print(
    ui.fail(
      `The app cannot use the root. Fallback 1: run auth:google --pick-folders, pick "Full Workspace" and "${year}", then run drive:check again. If it still fails, stop and decide on fallback 2 (drive:init).`,
    ),
  );

  return 1;
}

function formatCheck({ detail, id, outcome }: DriveCheck): string {
  const text = `${id}  ${detail}`;

  if (outcome === 'pass') {
    return ui.ok(text);
  }

  return outcome === 'fail' ? ui.fail(text) : ui.muted(`- ${text}`);
}
