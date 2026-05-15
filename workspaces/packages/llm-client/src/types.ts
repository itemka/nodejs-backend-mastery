export interface LlmCacheControl {
  readonly ttl?: '5m' | '1h';
  readonly type: 'ephemeral';
}

export interface LlmWebSearchCitation {
  readonly citedText: string;
  readonly encryptedIndex: string;
  readonly title: string | null;
  readonly type: 'web_search_result_location';
  readonly url: string;
}

export interface LlmCharLocationCitation {
  readonly citedText: string;
  readonly documentIndex: number;
  readonly documentTitle: string | null;
  readonly endCharIndex: number;
  readonly fileId?: string | null;
  readonly startCharIndex: number;
  readonly type: 'char_location';
}

export interface LlmPageLocationCitation {
  readonly citedText: string;
  readonly documentIndex: number;
  readonly documentTitle: string | null;
  readonly endPageNumber: number;
  readonly fileId?: string | null;
  readonly startPageNumber: number;
  readonly type: 'page_location';
}

export interface LlmContentBlockLocationCitation {
  readonly citedText: string;
  readonly documentIndex: number;
  readonly documentTitle: string | null;
  readonly endBlockIndex: number;
  readonly fileId?: string | null;
  readonly startBlockIndex: number;
  readonly type: 'content_block_location';
}

export type LlmDocumentCitation =
  | LlmCharLocationCitation
  | LlmPageLocationCitation
  | LlmContentBlockLocationCitation;

export type LlmTextCitation = LlmWebSearchCitation | LlmDocumentCitation;

export interface LlmTextBlock {
  readonly cacheControl?: LlmCacheControl;
  readonly citations?: readonly LlmTextCitation[];
  readonly text: string;
  readonly type: 'text';
}

export interface LlmToolUseBlock {
  readonly cacheControl?: LlmCacheControl;
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
  readonly cacheControl?: LlmCacheControl;
  readonly content: string;
  readonly is_error?: boolean;
  readonly tool_use_id: string;
  readonly type: 'tool_result';
}

// Names whose corresponding result blocks are modeled in LlmContentBlock and can
// safely round-trip back to Anthropic. Tools like web_fetch and
// text_editor_code_execution are returned by the SDK but their result blocks
// are not mapped here, so they intentionally fall through to LlmUnknownBlock.
export type LlmServerToolName = 'web_search' | 'code_execution' | 'bash_code_execution';

export interface LlmServerToolUseBlock {
  readonly cacheControl?: LlmCacheControl;
  readonly id: string;
  readonly input: unknown;
  readonly name: LlmServerToolName;
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

export interface LlmCodeExecutionOutputBlock {
  readonly fileId: string;
  readonly type: 'code_execution_output';
}

export interface LlmCodeExecutionResultBlock {
  readonly content: readonly LlmCodeExecutionOutputBlock[];
  readonly returnCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly type: 'code_execution_result';
}

export interface LlmCodeExecutionToolResultError {
  readonly errorCode: string;
  readonly type: 'code_execution_tool_result_error';
}

export interface LlmCodeExecutionToolResultBlock {
  readonly content: LlmCodeExecutionResultBlock | LlmCodeExecutionToolResultError;
  readonly toolUseId: string;
  readonly type: 'code_execution_tool_result';
}

export interface LlmBashCodeExecutionOutputBlock {
  readonly fileId: string;
  readonly type: 'bash_code_execution_output';
}

export interface LlmBashCodeExecutionResultBlock {
  readonly content: readonly LlmBashCodeExecutionOutputBlock[];
  readonly returnCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly type: 'bash_code_execution_result';
}

export interface LlmBashCodeExecutionToolResultError {
  readonly errorCode: string;
  readonly type: 'bash_code_execution_tool_result_error';
}

export interface LlmBashCodeExecutionToolResultBlock {
  readonly content: LlmBashCodeExecutionResultBlock | LlmBashCodeExecutionToolResultError;
  readonly toolUseId: string;
  readonly type: 'bash_code_execution_tool_result';
}

export interface LlmContainerUploadBlock {
  readonly cacheControl?: LlmCacheControl;
  readonly fileId: string;
  readonly type: 'container_upload';
}

export interface LlmThinkingBlock {
  readonly signature: string;
  readonly thinking: string;
  readonly type: 'thinking';
}

export interface LlmRedactedThinkingBlock {
  readonly data: string;
  readonly type: 'redacted_thinking';
}

export interface LlmBase64ImageSource {
  readonly data: string;
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  readonly type: 'base64';
}

export interface LlmUrlImageSource {
  readonly type: 'url';
  readonly url: string;
}

export interface LlmFileImageSource {
  readonly fileId: string;
  readonly type: 'file';
}

export type LlmImageSource = LlmBase64ImageSource | LlmUrlImageSource | LlmFileImageSource;

export interface LlmImageBlock {
  readonly cacheControl?: LlmCacheControl;
  readonly source: LlmImageSource;
  readonly type: 'image';
}

export interface LlmBase64PdfSource {
  readonly data: string;
  readonly mediaType: 'application/pdf';
  readonly type: 'base64';
}

export interface LlmUrlPdfSource {
  readonly type: 'url';
  readonly url: string;
}

export interface LlmPlainTextSource {
  readonly data: string;
  readonly mediaType: 'text/plain';
  readonly type: 'text';
}

export interface LlmFileDocumentSource {
  readonly fileId: string;
  readonly type: 'file';
}

export interface LlmContentDocumentSource {
  readonly content: readonly LlmTextBlock[];
  readonly type: 'content';
}

export type LlmDocumentSource =
  | LlmBase64PdfSource
  | LlmUrlPdfSource
  | LlmPlainTextSource
  | LlmFileDocumentSource
  | LlmContentDocumentSource;

export interface LlmDocumentBlock {
  readonly cacheControl?: LlmCacheControl;
  readonly citations?: { readonly enabled: boolean };
  readonly context?: string;
  readonly source: LlmDocumentSource;
  readonly title?: string;
  readonly type: 'document';
}

export interface LlmUnknownBlock {
  readonly raw: unknown;
  readonly type: 'unknown';
}

export type LlmContentBlock =
  | LlmTextBlock
  | LlmImageBlock
  | LlmDocumentBlock
  | LlmThinkingBlock
  | LlmRedactedThinkingBlock
  | LlmToolUseBlock
  | LlmToolResultBlock
  | LlmServerToolUseBlock
  | LlmWebSearchToolResultBlock
  | LlmCodeExecutionToolResultBlock
  | LlmBashCodeExecutionToolResultBlock
  | LlmContainerUploadBlock
  | LlmUnknownBlock;

export interface LlmToolInputSchema {
  readonly type: 'object';
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
}

export interface LlmCustomToolDefinition {
  readonly cacheControl?: LlmCacheControl;
  readonly kind?: 'custom';
  readonly description?: string;
  readonly inputExamples?: readonly Record<string, unknown>[];
  readonly inputSchema: LlmToolInputSchema;
  readonly name: string;
}

export interface LlmAnthropicTextEditorToolDefinition {
  readonly cacheControl?: LlmCacheControl;
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
  readonly cacheControl?: LlmCacheControl;
  readonly kind: 'anthropic_server';
  readonly maxUses?: number;
  readonly name: 'web_search';
  readonly provider: 'anthropic';
  readonly type: 'web_search_20250305';
  readonly userLocation?: LlmAnthropicUserLocation;
}

export interface LlmAnthropicCodeExecutionToolDefinition {
  readonly cacheControl?: LlmCacheControl;
  readonly kind: 'anthropic_server';
  readonly name: 'code_execution';
  readonly provider: 'anthropic';
  readonly type: 'code_execution_20250825';
}

export type LlmToolDefinition =
  | LlmCustomToolDefinition
  | LlmAnthropicTextEditorToolDefinition
  | LlmAnthropicWebSearchToolDefinition
  | LlmAnthropicCodeExecutionToolDefinition;

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

export interface LlmThinkingConfigEnabled {
  readonly budgetTokens: number;
  readonly type: 'enabled';
}

export interface LlmThinkingConfigAdaptive {
  readonly display?: 'summarized' | 'omitted';
  readonly type: 'adaptive';
}

export interface LlmThinkingConfigDisabled {
  readonly type: 'disabled';
}

export type LlmThinkingConfig =
  | LlmThinkingConfigEnabled
  | LlmThinkingConfigAdaptive
  | LlmThinkingConfigDisabled;

export interface LlmSystemPromptBlock {
  readonly cacheControl?: LlmCacheControl;
  readonly text: string;
  readonly type: 'text';
}

export type LlmSystemPrompt = string | readonly LlmSystemPromptBlock[];

export interface LlmRequest {
  readonly betas?: readonly string[];
  readonly fineGrainedToolStreaming?: boolean;
  readonly maxTokens: number;
  readonly messages: Messages;
  readonly model: string;
  readonly onTextDelta?: TextDeltaHandler;
  readonly onToolInputStreamEvent?: (event: LlmToolInputStreamEvent) => void;
  readonly outputFormat?: OutputFormatConfig;
  readonly stream?: boolean;
  readonly systemPrompt?: LlmSystemPrompt;
  readonly temperature?: number;
  readonly thinking?: LlmThinkingConfig;
  readonly tools?: readonly LlmToolDefinition[];
}

export interface LlmWebSearchSource {
  readonly citedText: string;
  readonly kind: 'web_search';
  readonly title: string | null;
  readonly url: string;
}

export interface LlmDocumentSourceRef {
  readonly citedText: string;
  readonly documentIndex: number;
  readonly documentTitle: string | null;
  readonly fileId?: string | null;
  readonly kind: 'document';
  readonly location:
    | {
        readonly endCharIndex: number;
        readonly startCharIndex: number;
        readonly type: 'char_location';
      }
    | {
        readonly endPageNumber: number;
        readonly startPageNumber: number;
        readonly type: 'page_location';
      }
    | {
        readonly endBlockIndex: number;
        readonly startBlockIndex: number;
        readonly type: 'content_block_location';
      };
}

export type LlmSource = LlmWebSearchSource | LlmDocumentSourceRef;

export interface LlmCacheCreationBreakdown {
  readonly ephemeral1hInputTokens: number;
  readonly ephemeral5mInputTokens: number;
}

export interface LlmServerToolUsage {
  readonly codeExecutionRequests?: number;
  readonly webFetchRequests?: number;
  readonly webSearchRequests?: number;
}

export interface LlmUsage {
  readonly cacheCreation?: LlmCacheCreationBreakdown;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly serverToolUse?: LlmServerToolUsage;
}

export interface LlmResponse {
  readonly content?: readonly LlmContentBlock[];
  readonly raw: unknown;
  readonly sources?: readonly LlmSource[];
  readonly stopReason?: string | null;
  readonly text: string;
  readonly usage?: LlmUsage;
}

export interface LlmProvider {
  createMessage(request: LlmRequest): Promise<LlmResponse>;
}
