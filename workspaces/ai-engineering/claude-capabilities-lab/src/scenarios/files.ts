import * as ui from '@workspaces/cli-output';
import { createAnthropicClient, createAnthropicFilesApi } from '@workspaces/packages/llm-client';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

import { type ParsedFlags, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import { ensureDirectory, loadFilesApiUpload, resolveOutputPath } from '../files/safety.js';

type Subcommand = 'upload' | 'list' | 'metadata' | 'delete' | 'download';

function parseSubcommand(value: string | undefined): Subcommand {
  if (
    value === 'upload' ||
    value === 'list' ||
    value === 'metadata' ||
    value === 'delete' ||
    value === 'download'
  ) {
    return value;
  }

  throw new Error('files <upload|list|metadata|delete|download> is required.');
}

export async function runFilesScenario(parsed: ParsedFlags): Promise<void> {
  const subcommand = parseSubcommand(parsed.positionals[1]);
  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const files = createAnthropicFilesApi(client);

  if (subcommand === 'upload') {
    const filePath = getString(parsed, 'file');

    if (filePath === undefined) {
      throw new Error('files upload requires --file=<path>.');
    }

    const validated = await loadFilesApiUpload(filePath);
    const fileLike = fs.createReadStream(validated.absolutePath);
    const metadata = await files.upload({ file: fileLike });
    console.log(ui.success('Uploaded:'), metadata);

    return;
  }

  if (subcommand === 'list') {
    const page = await files.list();

    if (page.files.length === 0) {
      console.log(ui.muted('No files.'));

      return;
    }

    for (const file of page.files) {
      console.log(
        `${ui.accent(file.id)}\t${file.filename}\t${ui.muted(`${file.mimeType}\t${file.sizeBytes}b\tdownloadable=${file.downloadable ?? 'unknown'}`)}`,
      );
    }

    if (page.hasMore) {
      console.log(ui.muted('(more results available)'));
    }

    return;
  }

  if (subcommand === 'metadata') {
    const fileId = getString(parsed, 'file-id');

    if (fileId === undefined) {
      throw new Error('files metadata requires --file-id=<id>.');
    }

    const metadata = await files.metadata(fileId);
    console.log(metadata);

    return;
  }

  if (subcommand === 'delete') {
    const fileId = getString(parsed, 'file-id');

    if (fileId === undefined) {
      throw new Error('files delete requires --file-id=<id>.');
    }

    const result = await files.delete(fileId);
    console.log(ui.success('Deleted:'), ui.muted(result.id));

    return;
  }

  // download
  const fileId = getString(parsed, 'file-id');

  if (fileId === undefined) {
    throw new Error('files download requires --file-id=<id>.');
  }

  const metadata = await files.metadata(fileId);

  if (metadata.downloadable === false) {
    throw new Error(`File ${fileId} is not marked as downloadable.`);
  }

  const outDir = getString(parsed, 'out-dir') ?? 'outputs';
  const { absolutePath, outDirPath } = resolveOutputPath(outDir, metadata.filename);

  await ensureDirectory(outDirPath);

  const download = await files.download(fileId);
  const buffer = Buffer.from(await download.arrayBuffer());

  await fsp.writeFile(absolutePath, buffer);

  console.log(
    ui.success(`Downloaded ${fileId} -> ${ui.muted(absolutePath)} (${buffer.byteLength} bytes)`),
  );
}
