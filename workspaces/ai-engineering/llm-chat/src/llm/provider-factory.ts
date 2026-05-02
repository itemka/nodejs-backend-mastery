import type { AppConfig } from '../config/env.js';
import { createAnthropicClient } from './anthropic/client.js';
import { createAnthropicProvider } from './anthropic/messages-api.js';
import type { LlmProvider } from './types.js';

export function createProvider(config: AppConfig): LlmProvider {
  const client = createAnthropicClient(config.anthropicApiKey);

  return createAnthropicProvider(client);
}
