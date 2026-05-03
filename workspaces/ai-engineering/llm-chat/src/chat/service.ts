import type { LlmProvider, LlmRequest } from '@workspaces/packages/llm-client';

import { addAssistantMessage, addUserMessage } from './history.js';
import type { ChatOptions, Messages } from './types.js';

export const DEFAULT_MAX_TOKENS = 1000;
export const DEFAULT_STREAM = true;

export interface ChatServiceConfig {
  readonly defaultMaxTokens?: number;
  readonly model: string;
  readonly provider: LlmProvider;
  readonly systemPrompt?: string;
  readonly temperature?: number;
}

export interface ChatService {
  sendUserTurn(messages: Messages, text: string, options?: ChatOptions): Promise<string>;
}

export function createChatService(config: ChatServiceConfig): ChatService {
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async sendUserTurn(messages, text, options = {}) {
      addUserMessage(messages, text);

      const request: LlmRequest = {
        maxTokens: options.maxTokens ?? defaultMaxTokens,
        messages,
        model: config.model,
        stream: options.stream ?? DEFAULT_STREAM,
        ...(options.onTextDelta ? { onTextDelta: options.onTextDelta } : {}),
        ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
        ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
        ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      };

      const response = await config.provider.createMessage(request);

      if (options.debugResponse) {
        console.log('Full response:', response.raw);
      }

      addAssistantMessage(messages, response.text);

      return response.text;
    },
  };
}
