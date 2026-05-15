import {
  createAnthropicClient,
  createAnthropicProvider,
  type LlmRequest,
  type LlmThinkingConfig,
} from '@workspaces/packages/llm-client';

import { type ParsedFlags, getBoolean, getInt, getString } from '../cli/args.js';
import { loadConfig } from '../config/env.js';
import {
  renderFinalAnswer,
  renderResponseDebug,
  renderThinking,
  renderUsage,
} from '../render/output.js';

const DEFAULT_PROMPT = 'Solve a small reasoning problem and explain the answer.';
const DEFAULT_MAX_TOKENS = 2048;

export function resolveThinkingConfig(parsed: ParsedFlags, model: string): LlmThinkingConfig {
  const mode = getString(parsed, 'thinking-mode');
  const budget = getInt(parsed, 'thinking-budget-tokens');
  const display = getString(parsed, 'thinking-display');

  const resolvedMode = mode ?? (budget === undefined ? 'adaptive' : 'enabled');

  if (resolvedMode === 'disabled') {
    return { type: 'disabled' };
  }

  if (resolvedMode === 'adaptive') {
    return {
      type: 'adaptive',
      ...(display === 'omitted' ? { display: 'omitted' as const } : {}),
      ...(display === 'summarized' ? { display: 'summarized' as const } : {}),
    };
  }

  if (resolvedMode === 'enabled') {
    if (model.startsWith('claude-opus-4-7')) {
      throw new Error(
        'Manual `enabled` thinking is not accepted on Opus 4.7. Use --thinking-mode=adaptive.',
      );
    }

    return { budgetTokens: budget ?? 1024, type: 'enabled' };
  }

  throw new Error(`Unknown --thinking-mode value: ${mode}`);
}

export async function runThinkingScenario(parsed: ParsedFlags): Promise<void> {
  const config = loadConfig();
  const client = createAnthropicClient(config.anthropicApiKey);
  const provider = createAnthropicProvider(client);
  const prompt = getString(parsed, 'prompt') ?? DEFAULT_PROMPT;
  const maxTokens = getInt(parsed, 'max-tokens') ?? DEFAULT_MAX_TOKENS;
  const thinking = resolveThinkingConfig(parsed, config.model);

  const request: LlmRequest = {
    maxTokens,
    messages: [{ content: prompt, role: 'user' }],
    model: config.model,
    stream: false,
    thinking,
  };

  const response = await provider.createMessage(request);
  console.log(
    renderThinking(response.content ?? [], { show: getBoolean(parsed, 'show-thinking') }),
  );
  console.log(renderFinalAnswer(response.text));
  console.log(renderUsage(response.usage));

  if (getBoolean(parsed, 'debug-response')) {
    console.log(renderResponseDebug(response));
  }
}
