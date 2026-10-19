import * as ui from '@workspaces/cli-output';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { DriveBackupStorage } from '../../adapters/drive/drive-backup-storage.js';
import { ResumableUploader } from '../../adapters/drive/resumable-upload.js';
import type { SidecarOutcome } from '../../application/ports.js';
import { devUploadEnvSchema, loadEnv } from '../../config/env.js';
import { backupFileName, DEV_FOLDER_NAME, jobIdFor } from '../../domain/naming.js';
import { localDateFor, periodFor, yearOfPeriod } from '../../domain/period.js';
import { digestFile } from '../../shared/digests.js';
import type { CliContext } from '../context.js';
import { createGoogleApi, createTokenProvider, fetchOption } from '../context.js';

const sidecarText: Record<SidecarOutcome, string> = {
  disabled: 'not written (WRITE_SHA256_SIDECAR=false)',
  exists: 'already in Drive',
  failed: 'failed (see the drive.sidecar.failed log line)',
  written: 'written',
};

/**
 * `dev:upload <file>`: the Drive path of a backup, run locally. The file is uploaded as today's
 * backup into `_dev/<YYYY>/` by the same storage code the worker uses. It runs only with
 * `APP_ENV=dev`, so the real year folders never receive a test file.
 */
export async function runDevUpload(
  options: { path: string },
  context: CliContext,
): Promise<number> {
  const env = loadEnv(devUploadEnvSchema, context.env);

  if (env.APP_ENV !== 'dev') {
    context.print(
      ui.fail(`dev:upload writes only to the ${DEV_FOLDER_NAME} folder: run it with APP_ENV=dev.`),
    );

    return 1;
  }

  const file = path.resolve(options.path);
  const isFile = await stat(file).then(
    (stats) => stats.isFile(),
    () => false,
  );

  if (!isFile) {
    context.print(ui.fail('The file does not exist or is not a regular file.'));

    return 1;
  }

  const digests = await digestFile(file);
  const now = context.clock.now();
  const period = periodFor(now, env.BACKUP_TIME_ZONE);
  const fileName = backupFileName(localDateFor(now, env.BACKUP_TIME_ZONE));
  const tokenProvider = createTokenProvider(context, env);
  const storage = new DriveBackupStorage({
    api: createGoogleApi(context, 'drive', tokenProvider),
    devFolder: true,
    logger: context.logger,
    rootFolderId: env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID,
    uploader: new ResumableUploader({ tokenProvider, ...fetchOption(context) }),
    writeSidecar: env.WRITE_SHA256_SIDECAR,
  });
  const result = await storage.upload({
    content: { kind: 'file', md5: digests.md5, path: file, sha256: digests.sha256 },
    fileName,
    jobId: jobIdFor(period, 'manual'),
    period,
  });
  const location = `${DEV_FOLDER_NAME}/${yearOfPeriod(period)}/${fileName}`;

  context.print(ui.heading('Dev upload'));
  context.print(
    result.uploaded
      ? ui.ok(`Uploaded ${location}; Drive's checksum matches.`)
      : ui.ok(`${location} is already in Drive with the same SHA-256; nothing was uploaded.`),
  );
  context.print(`  Drive file ID  ${result.driveFileId}`);
  context.print(`  size           ${result.sizeBytes} bytes`);
  context.print(`  SHA-256        ${result.sha256}`);
  context.print(`  sidecar        ${sidecarText[result.sidecar]}`);

  if (result.sidecar === 'failed') {
    context.print(ui.warn('Run dev:upload again to retry the sidecar.'));

    return 1;
  }

  return 0;
}
