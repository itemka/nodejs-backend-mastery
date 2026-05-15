import {
  createAnthropicClient,
  createAnthropicProvider,
  type LlmContentBlock,
} from '@workspaces/packages/llm-client';

import { type ParsedFlags, getBoolean, getInt, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import { loadImageFile } from '../files/safety.js';
import { renderFinalAnswer, renderResponseDebug, renderUsage } from '../render/output.js';

const DEFAULT_PROMPT =
  'Analyze this image and produce a fire risk rating from 1-4 based on visible vegetation and structure layout.';
const DEFAULT_MAX_TOKENS = 1024;

export async function runImageScenario(parsed: ParsedFlags): Promise<void> {
  const imagePaths = parsed.multi.get('image') ?? [];

  if (imagePaths.length === 0) {
    throw new Error('At least one --image=<path> is required.');
  }

  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const provider = createAnthropicProvider(client);
  const prompt = getString(parsed, 'prompt') ?? DEFAULT_PROMPT;
  const maxTokens = getInt(parsed, 'max-tokens') ?? DEFAULT_MAX_TOKENS;

  const imageBlocks: LlmContentBlock[] = [];

  for (const imagePath of imagePaths) {
    const { base64, mediaType } = await loadImageFile(imagePath);
    imageBlocks.push({
      source: { data: base64, mediaType, type: 'base64' },
      type: 'image',
    });
  }

  const userContent: LlmContentBlock[] = [...imageBlocks, { text: prompt, type: 'text' }];

  const response = await provider.createMessage({
    maxTokens,
    messages: [{ content: userContent, role: 'user' }],
    model: config.model,
    stream: false,
  });

  console.log(renderFinalAnswer(response.text));
  console.log(renderUsage(response.usage));

  if (getBoolean(parsed, 'debug-response')) {
    console.log(renderResponseDebug(response));
  }
}
