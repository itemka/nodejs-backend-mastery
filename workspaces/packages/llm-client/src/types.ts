export interface LlmTextBlock {
  readonly text: string;
  readonly type: 'text';
}

export interface LlmToolUseBlock {
  readonly id: string;
  readonly input: unknown;
  readonly name: string;
  readonly type: 'tool_use';
}

export interface LlmToolResultBlock {
  readonly content: string;
  readonly is_error?: boolean;
  readonly tool_use_id: string;
  readonly type: 'tool_result';
}

export interface LlmUnknownBlock {
  readonly raw: unknown;
  readonly type: 'unknown';
}

export type LlmContentBlock =
  | LlmTextBlock
  | LlmToolUseBlock
  | LlmToolResultBlock
  | LlmUnknownBlock;

export interface LlmToolInputSchema {
  readonly type: 'object';
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
}

export interface LlmToolDefinition {
  readonly description?: string;
  readonly inputExamples?: readonly Record<string, unknown>[];
  readonly inputSchema: LlmToolInputSchema;
  readonly name: string;
}

export interface ChatMessage {
  content: string | readonly LlmContentBlock[];
  role: 'user' | 'assistant';
}

export type Messages = ChatMessage[];

export type TextDeltaHandler = (text: string) => void;

export interface OutputFormatConfig {
  readonly assistantPrefill?: string;
  readonly instructions?: string;
  readonly jsonSchema?: Record<string, unknown>;
  readonly responseSuffix?: string;
  readonly stopSequences?: readonly string[];
}

export interface LlmRequest {
  readonly maxTokens: number;
  readonly messages: Messages;
  readonly model: string;
  readonly onTextDelta?: TextDeltaHandler;
  readonly outputFormat?: OutputFormatConfig;
  readonly stream?: boolean;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly tools?: readonly LlmToolDefinition[];
}

export interface LlmResponse {
  readonly content?: readonly LlmContentBlock[];
  readonly raw: unknown;
  readonly stopReason?: string | null;
  readonly text: string;
}

export interface LlmProvider {
  createMessage(request: LlmRequest): Promise<LlmResponse>;
}
