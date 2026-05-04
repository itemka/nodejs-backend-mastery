import type {
  LlmContentBlock,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolResultBlock,
  LlmToolUseBlock,
} from '@workspaces/packages/llm-client';

import { executeToolUse } from '../tools/runner.js';
import { createAppToolExecutionContext } from '../tools/types.js';
import type { AppTool, AppToolExecutionContext } from '../tools/types.js';
import { addAssistantContent, addUserMessage, addUserToolResultMessage } from './history.js';
import type { ChatOptions, Messages } from './types.js';

export const DEFAULT_MAX_TOKENS = 1000;
export const DEFAULT_STREAM = true;
export const DEFAULT_MAX_TOOL_ROUNDS = 5;

export interface ChatServiceConfig {
  readonly defaultMaxTokens?: number;
  readonly model: string;
  readonly provider: LlmProvider;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly toolContext?: AppToolExecutionContext;
  readonly tools?: readonly AppTool[];
}

export interface ChatService {
  sendUserTurn(messages: Messages, text: string, options?: ChatOptions): Promise<string>;
}

function extractToolUseBlocks(content: readonly LlmContentBlock[]): LlmToolUseBlock[] {
  return content.filter((block): block is LlmToolUseBlock => block.type === 'tool_use');
}

function contentFromResponse(response: LlmResponse): readonly LlmContentBlock[] {
  return response.content ?? [{ text: response.text, type: 'text' }];
}

export function createChatService(config: ChatServiceConfig): ChatService {
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  const tools = config.tools ?? [];
  const toolContext = config.toolContext ?? createAppToolExecutionContext();

  function createRequest(
    messages: Messages,
    options: ChatOptions,
    toolsEnabled: boolean,
  ): LlmRequest {
    return {
      maxTokens: options.maxTokens ?? defaultMaxTokens,
      messages,
      model: config.model,
      stream: toolsEnabled ? false : (options.stream ?? DEFAULT_STREAM),
      ...(toolsEnabled ? { tools: tools.map((tool) => tool.definition) } : {}),
      ...(!toolsEnabled && options.onTextDelta ? { onTextDelta: options.onTextDelta } : {}),
      ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
      ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
      ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    };
  }

  return {
    async sendUserTurn(messages, text, options = {}) {
      addUserMessage(messages, text);
      const toolsEnabled = options.toolsEnabled === true;

      if (!toolsEnabled) {
        const response = await config.provider.createMessage(
          createRequest(messages, options, false),
        );

        if (options.debugResponse) {
          console.log('Full response:', response.raw);
        }

        addAssistantContent(messages, contentFromResponse(response));

        return response.text;
      }

      const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

      for (let round = 0; round <= maxToolRounds; round += 1) {
        const response = await config.provider.createMessage(
          createRequest(messages, options, true),
        );

        if (options.debugResponse) {
          console.log('Full response:', response.raw);
        }

        if (response.stopReason !== 'tool_use') {
          addAssistantContent(messages, contentFromResponse(response));
          options.onToolEvent?.({ type: 'final_response_received' });

          return response.text;
        }

        if (round === maxToolRounds) {
          throw new Error(`Tool use exceeded the maximum round limit of ${maxToolRounds}.`);
        }

        const assistantContent = contentFromResponse(response);
        const toolUseBlocks = extractToolUseBlocks(assistantContent);

        if (toolUseBlocks.length === 0) {
          throw new Error('Provider returned tool_use without any tool_use content blocks.');
        }

        addAssistantContent(messages, assistantContent);

        for (const toolUse of toolUseBlocks) {
          options.onToolEvent?.({ toolName: toolUse.name, type: 'tool_requested' });
        }

        const toolResults: LlmToolResultBlock[] = [];

        for (const toolUse of toolUseBlocks) {
          options.onToolEvent?.({ toolName: toolUse.name, type: 'tool_running' });

          const result = await executeToolUse(toolUse, tools, toolContext);

          options.onToolEvent?.({
            toolName: toolUse.name,
            type: result.is_error === true ? 'tool_failed' : 'tool_succeeded',
          });
          toolResults.push(result);
        }

        addUserToolResultMessage(messages, toolResults);
        options.onToolEvent?.({ count: toolResults.length, type: 'tool_results_submitted' });
      }

      throw new Error('Tool use loop ended unexpectedly.');
    },
  };
}
