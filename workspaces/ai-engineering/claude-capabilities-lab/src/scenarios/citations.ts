import {
  createAnthropicClient,
  createAnthropicProvider,
  type LlmContentBlock,
  type LlmDocumentBlock,
} from '@workspaces/packages/llm-client';
import path from 'node:path';

import { type ParsedFlags, getBoolean, getInt, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import { loadPdfFile, loadTextFile } from '../files/safety.js';
import {
  renderFinalAnswer,
  renderResponseDebug,
  renderSources,
  renderUsage,
} from '../render/output.js';

const DEFAULT_PROMPT = 'Answer with citations: what is the document about?';
const DEFAULT_MAX_TOKENS = 1024;

export async function runCitationsScenario(parsed: ParsedFlags): Promise<void> {
  const pdfPath = getString(parsed, 'pdf');
  const textPath = getString(parsed, 'text-document');

  if (pdfPath === undefined && textPath === undefined) {
    throw new Error('Provide at least --pdf=<path> or --text-document=<path>.');
  }

  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const provider = createAnthropicProvider(client);
  const prompt = getString(parsed, 'prompt') ?? DEFAULT_PROMPT;
  const maxTokens = getInt(parsed, 'max-tokens') ?? DEFAULT_MAX_TOKENS;

  const documents: LlmDocumentBlock[] = [];

  if (pdfPath !== undefined) {
    const { base64, file } = await loadPdfFile(pdfPath);
    documents.push({
      citations: { enabled: true },
      source: { data: base64, mediaType: 'application/pdf', type: 'base64' },
      title: path.basename(file.absolutePath),
      type: 'document',
    });
  }

  if (textPath !== undefined) {
    const { content, file } = await loadTextFile(textPath);
    documents.push({
      citations: { enabled: true },
      source: { data: content, mediaType: 'text/plain', type: 'text' },
      title: path.basename(file.absolutePath),
      type: 'document',
    });
  }

  const userContent: LlmContentBlock[] = [...documents, { text: prompt, type: 'text' }];

  const response = await provider.createMessage({
    maxTokens,
    messages: [{ content: userContent, role: 'user' }],
    model: config.model,
    stream: false,
  });

  console.log(renderFinalAnswer(response.text));
  console.log(renderSources(response.sources));
  console.log(renderUsage(response.usage));

  if (getBoolean(parsed, 'debug-response')) {
    console.log(renderResponseDebug(response));
  }
}
