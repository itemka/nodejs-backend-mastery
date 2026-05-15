import {
  createAnthropicClient,
  createAnthropicFilesApi,
  createAnthropicProvider,
  DEFAULT_FILES_API_BETA,
  type LlmContentBlock,
} from '@workspaces/packages/llm-client';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { type ParsedFlags, getBoolean, getInt, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import {
  ensureDirectory,
  loadCodeExecUpload,
  resolveOutputDir,
  resolveOutputPath,
} from '../files/safety.js';
import { renderFinalAnswer, renderResponseDebug, renderUsage } from '../render/output.js';

const DEFAULT_PROMPT =
  'Run a detailed analysis to determine major drivers of churn. Your final output should include at least one detailed plot summarizing your findings. Critical note: Every time you execute code, you are starting with a completely clean slate. No variables or library imports from previous executions exist. You need to redeclare/reimport all variables/libraries.';
const DEFAULT_MAX_TOKENS = 4096;

export async function runCodeExecScenario(parsed: ParsedFlags): Promise<void> {
  const filePath = getString(parsed, 'file');

  if (filePath === undefined) {
    throw new Error('--file=<path> is required for the code-exec scenario.');
  }

  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const provider = createAnthropicProvider(client);
  const files = createAnthropicFilesApi(client);
  const prompt = getString(parsed, 'prompt') ?? DEFAULT_PROMPT;
  const maxTokens = getInt(parsed, 'max-tokens') ?? DEFAULT_MAX_TOKENS;
  const downloadOutputs = getBoolean(parsed, 'download-outputs');
  const outDir = getString(parsed, 'out-dir') ?? 'outputs';

  const validated = await loadCodeExecUpload(filePath);
  const uploadStream = fs.createReadStream(validated.absolutePath);
  const metadata = await files.upload({ file: uploadStream });
  console.log(`Uploaded ${path.basename(validated.absolutePath)} as ${metadata.id}`);

  const userContent: LlmContentBlock[] = [
    { fileId: metadata.id, type: 'container_upload' },
    { text: prompt, type: 'text' },
  ];

  const response = await provider.createMessage({
    betas: [DEFAULT_FILES_API_BETA],
    maxTokens,
    messages: [{ content: userContent, role: 'user' }],
    model: config.model,
    stream: false,
    tools: [
      {
        kind: 'anthropic_server',
        name: 'code_execution',
        provider: 'anthropic',
        type: 'code_execution_20250825',
      },
    ],
  });

  console.log(renderFinalAnswer(response.text));

  const outputFileIds: string[] = [];

  for (const block of response.content ?? []) {
    if (block.type === 'code_execution_tool_result') {
      const content = block.content;

      if (content.type !== 'code_execution_result') {
        console.log(`\n=== code_execution_tool_result_error: ${content.errorCode} ===`);
        continue;
      }

      console.log('\n=== code_execution_result ===');
      console.log(`return_code=${content.returnCode}`);

      if (content.stdout) {
        console.log(`stdout: ${content.stdout.slice(0, 800)}`);
      }

      if (content.stderr) {
        console.log(`stderr: ${content.stderr.slice(0, 800)}`);
      }

      for (const output of content.content) {
        console.log(`generated file_id=${output.fileId}`);
        outputFileIds.push(output.fileId);
      }

      continue;
    }

    if (block.type === 'bash_code_execution_tool_result') {
      const content = block.content;

      if (content.type !== 'bash_code_execution_result') {
        console.log(`\n=== bash_code_execution_tool_result_error: ${content.errorCode} ===`);
        continue;
      }

      console.log('\n=== bash_code_execution_result ===');
      console.log(`return_code=${content.returnCode}`);

      if (content.stdout) {
        console.log(`stdout: ${content.stdout.slice(0, 800)}`);
      }

      if (content.stderr) {
        console.log(`stderr: ${content.stderr.slice(0, 800)}`);
      }

      for (const output of content.content) {
        console.log(`generated file_id=${output.fileId}`);
        outputFileIds.push(output.fileId);
      }
    }
  }

  console.log(renderUsage(response.usage));

  if (downloadOutputs && outputFileIds.length > 0) {
    const { absolutePath: outDirPath } = resolveOutputDir(outDir);
    await ensureDirectory(outDirPath);

    for (const fileId of outputFileIds) {
      const meta = await files.metadata(fileId);

      if (meta.downloadable === false) {
        console.log(`Skipping ${fileId}: not downloadable.`);
        continue;
      }

      const { absolutePath } = resolveOutputPath(outDir, meta.filename);
      const download = await files.download(fileId);
      const buffer = Buffer.from(await download.arrayBuffer());

      await fsp.writeFile(absolutePath, buffer);

      console.log(`Downloaded ${fileId} -> ${absolutePath} (${buffer.byteLength} bytes)`);
    }
  }

  if (getBoolean(parsed, 'debug-response')) {
    console.log(renderResponseDebug(response));
  }
}
