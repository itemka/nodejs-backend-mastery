import {
  addCacheBreakpointOnLastBlock,
  createAnthropicClient,
  createAnthropicProvider,
  type LlmContentBlock,
  type LlmDocumentBlock,
  type LlmRequest,
} from '@workspaces/packages/llm-client';
import path from 'node:path';

import { type ParsedFlags, getBoolean, getInt, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import { loadPdfFile } from '../files/safety.js';
import {
  renderFinalAnswer,
  renderResponseDebug,
  renderSources,
  renderUsage,
} from '../render/output.js';

const DEFAULT_PROMPT = 'Summarize the document in one sentence.';
const DEFAULT_MAX_TOKENS = 1024;

export async function runPdfScenario(parsed: ParsedFlags): Promise<void> {
  const pdfPath = getString(parsed, 'pdf');

  if (pdfPath === undefined) {
    throw new Error('--pdf=<path> is required for the pdf scenario.');
  }

  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const provider = createAnthropicProvider(client);
  const prompt = getString(parsed, 'prompt') ?? DEFAULT_PROMPT;
  const maxTokens = getInt(parsed, 'max-tokens') ?? DEFAULT_MAX_TOKENS;
  const citationsEnabled = getBoolean(parsed, 'citations');
  const cacheEnabled = getBoolean(parsed, 'cache');

  const { base64, file } = await loadPdfFile(pdfPath);
  const documentBlock: LlmDocumentBlock = {
    source: { data: base64, mediaType: 'application/pdf', type: 'base64' },
    title: path.basename(file.absolutePath),
    type: 'document',
    ...(citationsEnabled ? { citations: { enabled: true } } : {}),
  };

  const userContent: LlmContentBlock[] = [documentBlock, { text: prompt, type: 'text' }];

  let request: LlmRequest = {
    maxTokens,
    messages: [{ content: userContent, role: 'user' }],
    model: config.model,
    stream: false,
  };

  if (cacheEnabled) {
    request = addCacheBreakpointOnLastBlock(
      request,
      { type: 'ephemeral' },
      (block) => block.type === 'document',
    );
  }

  const response = await provider.createMessage(request);

  console.log(renderFinalAnswer(response.text));

  if (citationsEnabled) {
    console.log(renderSources(response.sources));
  }

  console.log(renderUsage(response.usage));

  if (getBoolean(parsed, 'debug-response')) {
    console.log(renderResponseDebug(response));
  }
}
