import type {
  LlmWebSearchSource,
  OutputFormatConfig,
  TextDeltaHandler,
} from '@workspaces/packages/llm-client';

export type { ChatMessage, Messages } from '@workspaces/packages/llm-client';

export type ToolEvent =
  | { readonly toolName: string; readonly type: 'tool_requested' }
  | { readonly toolName: string; readonly type: 'tool_running' }
  | { readonly toolName: string; readonly type: 'tool_succeeded' }
  | { readonly toolName: string; readonly type: 'tool_failed' }
  | { readonly count: number; readonly type: 'tool_results_submitted' }
  | { readonly type: 'final_response_received' }
  | { readonly toolName: string; readonly type: 'tool_input_stream_started' }
  | { readonly toolName: string; readonly type: 'tool_input_stream_completed' }
  | { readonly toolName: string; readonly type: 'tool_input_stream_failed' };

export type ToolEventHandler = (event: ToolEvent) => void;

export type SourcesHandler = (sources: readonly LlmWebSearchSource[]) => void;

export interface ChatOptions {
  debugResponse?: boolean;
  fineGrainedToolStreaming?: boolean;
  maxTokens?: number;
  maxToolRounds?: number;
  onSources?: SourcesHandler;
  onTextDelta?: TextDeltaHandler;
  onToolEvent?: ToolEventHandler;
  outputFormat?: OutputFormatConfig;
  stream?: boolean;
  toolsEnabled?: boolean;
}
