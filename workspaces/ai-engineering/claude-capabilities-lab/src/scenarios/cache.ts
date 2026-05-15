import {
  addCacheBreakpointOnLastBlock,
  addCacheBreakpointOnLastTool,
  createAnthropicClient,
  createAnthropicProvider,
  withSystemPromptCache,
  type LlmCacheControl,
  type LlmContentBlock,
  type LlmRequest,
} from '@workspaces/packages/llm-client';
import path from 'node:path';

import { type ParsedFlags, getBoolean, getInt, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import { loadImageFile, loadPdfFile } from '../files/safety.js';
import { renderFinalAnswer, renderResponseDebug, renderUsage } from '../render/output.js';

export type CacheTarget = 'system' | 'tools' | 'document' | 'image' | 'last-message';

const DEFAULT_PROMPT = 'Summarize the document.';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_SYSTEM_PROMPT =
  'You are a careful, concise analyst. Always reply with one paragraph followed by 2-3 numbered facts.';

function parseTarget(value: string | undefined): CacheTarget {
  if (
    value === 'system' ||
    value === 'tools' ||
    value === 'document' ||
    value === 'image' ||
    value === 'last-message'
  ) {
    return value;
  }

  throw new Error(`--target must be one of: system, tools, document, image, last-message.`);
}

function parseTtl(value: string | undefined): '5m' | '1h' | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === '5m' || value === '1h') {
    return value;
  }

  throw new Error('--ttl must be "5m" or "1h".');
}

export function validateCacheTargetArgs(
  target: CacheTarget,
  options: { readonly documentPath?: string; readonly imagePath?: string },
): void {
  if (target === 'document' && options.documentPath === undefined) {
    throw new Error('--target=document requires --document=<path>.');
  }

  if (target === 'image' && options.imagePath === undefined) {
    throw new Error('--target=image requires --image=<path>.');
  }
}

export async function runCacheScenario(parsed: ParsedFlags): Promise<void> {
  const target = parseTarget(getString(parsed, 'target'));
  const ttl = parseTtl(getString(parsed, 'ttl'));
  const prompt = getString(parsed, 'prompt') ?? DEFAULT_PROMPT;
  const maxTokens = getInt(parsed, 'max-tokens') ?? DEFAULT_MAX_TOKENS;
  const documentPath = getString(parsed, 'document');
  const imagePath = parsed.multi.get('image')?.[0];

  validateCacheTargetArgs(target, {
    ...(documentPath === undefined ? {} : { documentPath }),
    ...(imagePath === undefined ? {} : { imagePath }),
  });

  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const provider = createAnthropicProvider(client);
  const cacheControl: LlmCacheControl = {
    type: 'ephemeral',
    ...(ttl === undefined ? {} : { ttl }),
  };

  const blocks: LlmContentBlock[] = [];

  if (documentPath !== undefined) {
    const { base64, file } = await loadPdfFile(documentPath);
    blocks.push({
      source: { data: base64, mediaType: 'application/pdf', type: 'base64' },
      title: path.basename(file.absolutePath),
      type: 'document',
    });
  }

  if (imagePath !== undefined) {
    const { base64, mediaType } = await loadImageFile(imagePath);
    blocks.push({ source: { data: base64, mediaType, type: 'base64' }, type: 'image' });
  }

  blocks.push({ text: prompt, type: 'text' });

  let request: LlmRequest = {
    maxTokens,
    messages: [{ content: blocks, role: 'user' }],
    model: config.model,
    stream: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };

  switch (target) {
    case 'system': {
      request = withSystemPromptCache(request, cacheControl);

      break;
    }

    case 'tools': {
      request = {
        ...request,
        tools: [
          {
            description: 'No-op stable helper for demonstrating tools-cache breakpoints.',
            inputSchema: { properties: {}, type: 'object' as const },
            name: 'noop',
          },
        ],
      };
      request = addCacheBreakpointOnLastTool(request, cacheControl);

      break;
    }

    case 'document': {
      request = addCacheBreakpointOnLastBlock(
        request,
        cacheControl,
        (block) => block.type === 'document',
      );

      break;
    }

    case 'image': {
      request = addCacheBreakpointOnLastBlock(
        request,
        cacheControl,
        (block) => block.type === 'image',
      );

      break;
    }

    default: {
      request = addCacheBreakpointOnLastBlock(request, cacheControl);
    }
  }

  const response = await provider.createMessage(request);
  console.log(renderFinalAnswer(response.text));
  console.log(renderUsage(response.usage));

  if (getBoolean(parsed, 'debug-response')) {
    console.log(renderResponseDebug(response));
  }
}
