export interface LlmWebSearchCitation {
  readonly citedText: string;
  readonly encryptedIndex: string;
  readonly title: string | null;
  readonly type: 'web_search_result_location';
  readonly url: string;
}

export type LlmTextCitation = LlmWebSearchCitation;

export interface LlmTextBlock {
  readonly citations?: readonly LlmTextCitation[];
  readonly text: string;
  readonly type: 'text';
}

export interface LlmToolUseBlock {
  readonly id: string;
  readonly input: unknown;
  readonly inputError?: { readonly code: 'invalid_json'; readonly message: string };
  readonly name: string;
  readonly type: 'tool_use';
}

export interface LlmToolInputStreamEvent {
  readonly name: string;
  readonly type:
    | 'tool_input_stream_started'
    | 'tool_input_stream_completed'
    | 'tool_input_stream_failed';
}

export interface LlmToolResultBlock {
  readonly content: string;
  readonly is_error?: boolean;
  readonly tool_use_id: string;
  readonly type: 'tool_result';
}

export interface LlmServerToolUseBlock {
  readonly id: string;
  readonly input: unknown;
  readonly name: 'web_search';
  readonly type: 'server_tool_use';
}

export interface LlmWebSearchResultEntry {
  readonly encryptedContent: string;
  readonly pageAge?: string | null;
  readonly title: string;
  readonly type: 'web_search_result';
  readonly url: string;
}

export interface LlmWebSearchToolResultError {
  readonly errorCode: string;
  readonly type: 'web_search_tool_result_error';
}

export interface LlmWebSearchToolResultBlock {
  readonly content: readonly LlmWebSearchResultEntry[] | LlmWebSearchToolResultError;
  readonly toolUseId: string;
  readonly type: 'web_search_tool_result';
}

export interface LlmUnknownBlock {
  readonly raw: unknown;
  readonly type: 'unknown';
}

export type LlmContentBlock =
  | LlmTextBlock
  | LlmToolUseBlock
  | LlmToolResultBlock
  | LlmServerToolUseBlock
  | LlmWebSearchToolResultBlock
  | LlmUnknownBlock;

export interface LlmToolInputSchema {
  readonly type: 'object';
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
}

export interface LlmCustomToolDefinition {
  readonly kind?: 'custom';
  readonly description?: string;
  readonly inputExamples?: readonly Record<string, unknown>[];
  readonly inputSchema: LlmToolInputSchema;
  readonly name: string;
}

export interface LlmAnthropicTextEditorToolDefinition {
  readonly kind: 'anthropic_builtin';
  readonly maxCharacters?: number;
  readonly name: 'str_replace_based_edit_tool';
  readonly provider: 'anthropic';
  readonly type: 'text_editor_20250728';
}

export interface LlmAnthropicUserLocation {
  readonly city?: string;
  readonly country?: string;
  readonly region?: string;
  readonly timezone?: string;
  readonly type: 'approximate';
}

export interface LlmAnthropicWebSearchToolDefinition {
  readonly allowedDomains?: readonly string[];
  readonly blockedDomains?: readonly string[];
  readonly kind: 'anthropic_server';
  readonly maxUses?: number;
  readonly name: 'web_search';
  readonly provider: 'anthropic';
  readonly type: 'web_search_20250305';
  readonly userLocation?: LlmAnthropicUserLocation;
}

export type LlmToolDefinition =
  | LlmCustomToolDefinition
  | LlmAnthropicTextEditorToolDefinition
  | LlmAnthropicWebSearchToolDefinition;

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
  readonly fineGrainedToolStreaming?: boolean;
  readonly maxTokens: number;
  readonly messages: Messages;
  readonly model: string;
  readonly onTextDelta?: TextDeltaHandler;
  readonly onToolInputStreamEvent?: (event: LlmToolInputStreamEvent) => void;
  readonly outputFormat?: OutputFormatConfig;
  readonly stream?: boolean;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly tools?: readonly LlmToolDefinition[];
}

export interface LlmWebSearchSource {
  readonly citedText: string;
  readonly kind: 'web_search';
  readonly title: string | null;
  readonly url: string;
}

export interface LlmResponse {
  readonly content?: readonly LlmContentBlock[];
  readonly raw: unknown;
  readonly sources?: readonly LlmWebSearchSource[];
  readonly stopReason?: string | null;
  readonly text: string;
}

export interface LlmProvider {
  createMessage(request: LlmRequest): Promise<LlmResponse>;
}
