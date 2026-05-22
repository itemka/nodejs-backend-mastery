import type {
  ChatMessage,
  LlmContentBlock,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolDefinition,
  LlmToolResultBlock,
  LlmToolUseBlock,
} from '@workspaces/packages/llm-client';

import type { McpToolManager } from './mcp-tool-manager.js';
import type { ChatOptions, Messages } from './types.js';

export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_MAX_TOOL_ROUNDS = 5;
export const DEFAULT_MAX_PAUSE_CONTINUATIONS = 5;

export interface ChatSessionConfig {
  readonly defaultMaxTokens?: number;
  readonly model: string;
  readonly provider: LlmProvider;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly toolManager: McpToolManager;
}

export interface ChatSession {
  appendMessages(messages: readonly ChatMessage[]): void;
  readonly history: Messages;
  sendUserMessage(text: string, options?: ChatOptions): Promise<string>;
}

function extractToolUseBlocks(content: readonly LlmContentBlock[]): LlmToolUseBlock[] {
  return content.filter((block): block is LlmToolUseBlock => block.type === 'tool_use');
}

function contentFromResponse(response: LlmResponse): readonly LlmContentBlock[] {
  return response.content ?? [{ text: response.text, type: 'text' }];
}

function createPauseContinuationLimitError(): Error {
  return new Error(
    `Provider returned pause_turn more than ${String(DEFAULT_MAX_PAUSE_CONTINUATIONS)} times.`,
  );
}

export function createChatSession(config: ChatSessionConfig): ChatSession {
  const history: Messages = [];
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  function buildRequest(options: ChatOptions): LlmRequest {
    const tools: readonly LlmToolDefinition[] = config.toolManager.toolDefinitions();

    return {
      maxTokens: options.maxTokens ?? defaultMaxTokens,
      messages: history,
      model: config.model,
      stream: options.stream ?? true,
      ...(tools.length > 0 ? { tools } : {}),
      ...(options.onTextDelta === undefined ? {} : { onTextDelta: options.onTextDelta }),
      ...(options.outputFormat === undefined ? {} : { outputFormat: options.outputFormat }),
      ...(config.systemPrompt === undefined ? {} : { systemPrompt: config.systemPrompt }),
      ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    };
  }

  return {
    appendMessages(messages) {
      history.push(...messages);
    },
    get history() {
      return history;
    },
    async sendUserMessage(text, options = {}) {
      history.push({ content: text, role: 'user' });
      const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
      let pauseContinuations = 0;
      let toolRounds = 0;

      while (true) {
        const response = await config.provider.createMessage(buildRequest(options));
        const assistantContent = contentFromResponse(response);

        if (response.stopReason === 'pause_turn') {
          if (pauseContinuations >= DEFAULT_MAX_PAUSE_CONTINUATIONS) {
            throw createPauseContinuationLimitError();
          }

          history.push({ content: assistantContent, role: 'assistant' });
          pauseContinuations += 1;
          continue;
        }

        if (response.stopReason !== 'tool_use') {
          history.push({ content: assistantContent, role: 'assistant' });
          options.onToolEvent?.({ type: 'final_response_received' });

          return response.text;
        }

        history.push({ content: assistantContent, role: 'assistant' });

        const toolUseBlocks = extractToolUseBlocks(assistantContent);

        if (toolUseBlocks.length === 0) {
          throw new Error('Provider returned tool_use without any tool_use content blocks.');
        }

        if (toolRounds >= maxToolRounds) {
          throw new Error(`Tool use exceeded the maximum round limit of ${String(maxToolRounds)}.`);
        }

        for (const toolUse of toolUseBlocks) {
          options.onToolEvent?.({ toolName: toolUse.name, type: 'tool_requested' });
        }

        const results: LlmToolResultBlock[] = [];

        for (const toolUse of toolUseBlocks) {
          options.onToolEvent?.({ toolName: toolUse.name, type: 'tool_running' });

          const result = await config.toolManager.callTool(toolUse);

          options.onToolEvent?.({
            toolName: toolUse.name,
            type: result.is_error === true ? 'tool_failed' : 'tool_succeeded',
          });
          results.push(result);
        }

        history.push({ content: results, role: 'user' });
        options.onToolEvent?.({ count: results.length, type: 'tool_results_submitted' });
        toolRounds += 1;
      }
    },
  };
}
