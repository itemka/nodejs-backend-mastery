import * as ui from '@workspaces/cli-output';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GmailApi } from '../../adapters/gmail/gmail-api.js';
import { GmailExportEmailFinder } from '../../adapters/gmail/gmail-export-email-finder.js';
import { cookieHeaderFor } from '../../adapters/transfer/download-cookies.js';
import { HttpDownloader } from '../../adapters/transfer/http-downloader.js';
import { verifyZipArchive } from '../../adapters/transfer/zip-archive-verifier.js';
import { IntegrationError } from '../../application/integration-error.js';
import { devDownloadEnvSchema, loadEnv } from '../../config/env.js';
import { localDateFor, startOfLocalDay } from '../../domain/period.js';
import { SecretValue } from '../../shared/secret-value.js';
import type { CliContext } from '../context.js';
import {
  createGoogleApi,
  createNotionSessions,
  createTokenProvider,
  fetchOption,
} from '../context.js';

/** The export link expires 7 days after the export (Phase 0), so older emails cannot download. */
const DEFAULT_LOOKBACK_MS = 7 * 86_400_000;

/** A ZIP's local file header (`PK\x03\x04`). */
const ZIP_SIGNATURE = Buffer.from([80, 75, 3, 4]);

/**
 * `dev:download [--email-since YYYY-MM-DD]`: whether the dev Notion session downloads the export,
 * as the transfer will. It finds the newest trusted export email, follows its link, downloads the
 * ZIP with the session's cookies into a temporary directory, checks it, prints its size, SHA-256
 * and file count, and deletes it. Nothing is uploaded. It runs only with `APP_ENV=dev`.
 */
export async function runDevDownload(
  options: { emailSince: string | undefined },
  context: CliContext,
): Promise<number> {
  const env = loadEnv(devDownloadEnvSchema, context.env);

  if (env.APP_ENV !== 'dev') {
    context.print(
      ui.fail('dev:download uses the dev Notion session only: run it with APP_ENV=dev.'),
    );

    return 1;
  }

  const timeZone = env.BACKUP_TIME_ZONE;
  const now = context.clock.now();
  const since =
    options.emailSince === undefined
      ? new Date(now.getTime() - DEFAULT_LOOKBACK_MS)
      : startOfLocalDay(options.emailSince, timeZone);
  const tokens = createTokenProvider(context, env);
  const finder = new GmailExportEmailFinder({
    gmail: new GmailApi(createGoogleApi(context, 'gmail', tokens)),
    logger: context.logger,
  });

  context.print(ui.heading('Dev download'));

  const search = await finder.findReadyEmail({ excludeIds: [], requestedAfter: since });

  if (search.status === 'not_found') {
    context.print(ui.fail(`No trusted export email since ${localDateFor(since, timeZone)}.`));

    return 1;
  }

  const downloader = new HttpDownloader({
    clock: context.clock,
    logger: context.logger,
    ...fetchOption(context),
  });
  const target = await downloader.resolve(await finder.getDownloadLink(search.email.messageId));

  context.print(`  email          ${search.email.messageId}, received ${search.email.receivedAt}`);
  context.print(`  link expires   ${target.expiresAt.toISOString()}`);

  if (target.expiresAt.getTime() <= context.clock.now().getTime()) {
    context.print(ui.fail('The link has expired; run dev:trigger for a new export.'));

    return 1;
  }

  const session = await createNotionSessions(context, env).load();
  const header = cookieHeaderFor(session.storageState.cookies, target.url.reveal(), now);

  if (header === undefined) {
    throw new IntegrationError(
      'NOTION_SESSION_EXPIRED',
      "The saved Notion session has no unexpired cookie for Notion's file host",
    );
  }

  const directory = await mkdtemp(
    path.join(context.tempDirectory ?? tmpdir(), 'nba-dev-download-'),
  );

  try {
    const file = path.join(directory, 'export.zip');
    const result = await downloader.download({
      cookieHeader: new SecretValue(header),
      path: file,
      target,
    });

    if (result.outcome === 'link_expired') {
      context.print(ui.fail("Notion's file host refused the link after its expiry."));

      return 1;
    }

    const signature = await readStart(file, ZIP_SIGNATURE.length);
    const { entryCount, uncompressedBytes } = await verifyZipArchive(file);

    const startsWith = signature.equals(ZIP_SIGNATURE)
      ? String.raw`PK\x03\x04`
      : 'another signature';

    context.print(ui.ok('Downloaded with the dev session, and the ZIP passed its checks.'));
    context.print(`  starts with    ${startsWith}`);
    context.print(`  size           ${result.digests.sizeBytes} bytes`);
    context.print(`  SHA-256        ${result.digests.sha256}`);
    context.print(`  files          ${entryCount}, ${uncompressedBytes} bytes uncompressed`);
    context.print(ui.muted('The temporary copy is deleted; nothing was uploaded.'));

    return signature.equals(ZIP_SIGNATURE) ? 0 : 1;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function readStart(file: string, length: number): Promise<Buffer> {
  const handle = await open(file, 'r');

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
