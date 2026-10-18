import * as ui from '@workspaces/cli-output';
import path from 'node:path';

import { GmailApi } from '../../adapters/gmail/gmail-api.js';
import {
  authorizeOffline,
  createOAuthClient,
  shortScope,
} from '../../adapters/google/oauth-client.js';
import { grantFoldersWithPicker } from '../../adapters/google/picker-grant.js';
import { IntegrationError } from '../../application/integration-error.js';
import { googleAuthEnvSchema, googlePickerEnvSchema, loadEnv } from '../../config/env.js';
import { localDateFor } from '../../domain/period.js';
import { upsertEnvFile } from '../../shared/env-file.js';
import { maskEmail, maskToken } from '../../shared/mask.js';
import type { CliContext } from '../context.js';
import { createGoogleApi, fetchOption } from '../context.js';

export interface AuthGoogleOptions {
  pickFolders: boolean;
  print: boolean;
}

/**
 * `auth:google`: a loopback consent for `gmail.readonly` + `drive.file` that writes
 * `GOOGLE_REFRESH_TOKEN` into `.env.local`. Output shows the token only masked, unless `--print`.
 */
export async function runAuthGoogle(
  options: AuthGoogleOptions,
  context: CliContext,
): Promise<number> {
  if (options.pickFolders) {
    return runPickFolders(context);
  }

  const env = loadEnv(googleAuthEnvSchema, context.env);
  const client = createOAuthClient({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    ...fetchOption(context),
  });

  context.print(ui.heading('Google consent: gmail.readonly and drive.file'));
  context.print('Sign in as the test user that owns the Gmail and Drive data, and allow both.');

  const grant = await authorizeOffline(client, { openBrowser: context.openBrowser });

  await upsertEnvFile(context.envFilePath, { GOOGLE_REFRESH_TOKEN: grant.refreshToken });

  const mailbox = await maskedMailbox(grant.accessToken, context);
  const today = localDateFor(context.clock.now(), env.BACKUP_TIME_ZONE);

  context.print(
    ui.ok(`Saved GOOGLE_REFRESH_TOKEN to ${path.basename(context.envFilePath)} (mode 0600)`),
  );
  context.print(`  token    ${maskToken(grant.refreshToken)}`);
  context.print(`  mailbox  ${mailbox}`);
  context.print(`  scopes   ${grant.scopes.map((scope) => shortScope(scope)).join(', ')}`);

  if (options.print) {
    context.print(ui.warn('The refresh token. Paste it into 1Password, then clear the terminal:'));
    context.print(grant.refreshToken);
  }

  context.print(ui.heading('Next'));
  context.print(
    `  1. Copy the token into 1Password ("Notion Backup Agent"), labelled "temporary, Testing, ${today}".`,
  );
  context.print('     Run with --print to show it, or read it from .env.local.');
  context.print(
    '  2. Add it to Vercel as GOOGLE_REFRESH_TOKEN (Production, Sensitive) in Step 22.',
  );
  context.print('  While the OAuth app is in Testing, the token expires after 7 days.');

  return 0;
}

/** S6 fallback 1: grant the backup folders to the app through the Picker. Saves nothing. */
async function runPickFolders(context: CliContext): Promise<number> {
  const env = loadEnv(googlePickerEnvSchema, context.env);
  const client = createOAuthClient({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    ...fetchOption(context),
  });

  context.print(ui.heading('Drive Picker grant (S6 fallback 1)'));
  context.print('In the Picker, select "Full Workspace" and its year folder, such as "2026".');

  const grant = await grantFoldersWithPicker(client, env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID, {
    openBrowser: context.openBrowser,
  });

  // Drive IDs are not secret, and they are the only way to tell two same-named folders apart.
  context.print(`  picked items  ${grant.pickedIds.length}`);

  for (const id of grant.pickedIds) {
    context.print(`    ${id}`);
  }

  if (!grant.rootPicked) {
    context.print(
      ui.fail(
        `GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID (${env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID}) was not among the picked items.`,
      ),
    );
    context.print(
      '  Open https://drive.google.com/drive/folders/<ID> to see which folder an ID is.',
    );
    context.print('  Pick the configured root, or correct GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID.');

    return 1;
  }

  context.print(
    ui.ok('The backup root was granted. The access token of this consent is discarded.'),
  );
  context.print('Next: run drive:check.');

  return 0;
}

async function maskedMailbox(accessToken: string, context: CliContext): Promise<string> {
  const gmail = new GmailApi(
    createGoogleApi(context, 'gmail', { getAccessToken: () => Promise.resolve(accessToken) }),
  );

  try {
    const { emailAddress } = await gmail.getProfile();

    return maskEmail(emailAddress);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return `unavailable (${error.code})`;
    }

    throw error;
  }
}
