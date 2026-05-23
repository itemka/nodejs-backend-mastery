import type { OutputFormatConfig, TextDeltaHandler } from '@workspaces/packages/llm-client';

export type { ChatMessage, Messages } from '@workspaces/packages/llm-client';

export type ToolEvent =
  | { readonly toolName: string; readonly type: 'tool_requested' }
  | { readonly toolName: string; readonly type: 'tool_running' }
  | { readonly toolName: string; readonly type: 'tool_succeeded' }
  | { readonly toolName: string; readonly type: 'tool_failed' }
  | { readonly count: number; readonly type: 'tool_results_submitted' }
  | { readonly type: 'final_response_received' };

export type ToolEventHandler = (event: ToolEvent) => void;

export interface ChatOptions {
  maxTokens?: number;
  maxToolRounds?: number;
  onTextDelta?: TextDeltaHandler;
  onToolEvent?: ToolEventHandler;
  outputFormat?: OutputFormatConfig;
  stream?: boolean;
}
