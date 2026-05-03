import type { OutputFormatConfig, TextDeltaHandler } from '@workspaces/packages/llm-client';

export type { ChatMessage, Messages } from '@workspaces/packages/llm-client';

export interface ChatOptions {
  debugResponse?: boolean;
  maxTokens?: number;
  onTextDelta?: TextDeltaHandler;
  outputFormat?: OutputFormatConfig;
  stream?: boolean;
}
