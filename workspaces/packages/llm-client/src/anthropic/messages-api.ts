import type Anthropic from '@anthropic-ai/sdk';
import type {
  Base64ImageSource,
  Base64PDFSource,
  BashCodeExecutionResultBlock,
  BashCodeExecutionResultBlockParam,
  BashCodeExecutionToolResultBlock,
  BashCodeExecutionToolResultBlockParam,
  BashCodeExecutionToolResultError,
  BashCodeExecutionToolResultErrorCode,
  BashCodeExecutionToolResultErrorParam,
  CacheControlEphemeral,
  CitationCharLocation,
  CitationCharLocationParam,
  CitationContentBlockLocation,
  CitationContentBlockLocationParam,
  CitationPageLocation,
  CitationPageLocationParam,
  CitationWebSearchResultLocationParam,
  CitationsWebSearchResultLocation,
  CodeExecutionResultBlock,
  CodeExecutionResultBlockParam,
  CodeExecutionTool20250825,
  CodeExecutionToolResultBlock,
  CodeExecutionToolResultBlockParam,
  CodeExecutionToolResultError,
  CodeExecutionToolResultErrorCode,
  CodeExecutionToolResultErrorParam,
  ContainerUploadBlock,
  ContainerUploadBlockParam,
  ContentBlock,
  ContentBlockParam,
  DocumentBlockParam,
  ImageBlockParam,
  Message,
  MessageParam,
  PlainTextSource,
  RedactedThinkingBlock,
  RedactedThinkingBlockParam,
  ServerToolUseBlock,
  ServerToolUseBlockParam,
  TextBlock,
  TextBlockParam,
  TextCitation,
  TextCitationParam,
  ThinkingBlock,
  ThinkingBlockParam,
  ThinkingConfigParam,
  Tool,
  ToolTextEditor20250728,
  ToolUnion,
  URLImageSource,
  URLPDFSource,
  Usage,
  WebSearchResultBlock,
  WebSearchResultBlockParam,
  WebSearchTool20250305,
  WebSearchToolRequestError,
  WebSearchToolResultBlock,
  WebSearchToolResultBlockParamContent,
} from '@anthropic-ai/sdk/resources/messages/messages';

import type {
  LlmAnthropicCodeExecutionToolDefinition,
  LlmAnthropicWebSearchToolDefinition,
  LlmBashCodeExecutionOutputBlock,
  LlmBashCodeExecutionResultBlock,
  LlmBashCodeExecutionToolResultBlock,
  LlmCacheControl,
  LlmCharLocationCitation,
  LlmCodeExecutionOutputBlock,
  LlmCodeExecutionResultBlock,
  LlmCodeExecutionToolResultBlock,
  LlmContainerUploadBlock,
  LlmContentBlock,
  LlmContentBlockLocationCitation,
  LlmContentDocumentSource,
  LlmCustomToolDefinition,
  LlmDocumentBlock,
  LlmDocumentSourceRef,
  LlmImageBlock,
  LlmImageSource,
  LlmPageLocationCitation,
  LlmProvider,
  LlmRedactedThinkingBlock,
  LlmRequest,
  LlmResponse,
  LlmSource,
  LlmSystemPromptBlock,
  LlmTextBlock,
  LlmTextCitation,
  LlmThinkingBlock,
  LlmThinkingConfig,
  LlmToolDefinition,
  LlmToolInputSchema,
  LlmUsage,
  LlmWebSearchResultEntry,
  LlmWebSearchSource,
  LlmWebSearchToolResultBlock,
} from '../types.js';
import { textFromMessage } from './text.js';
import { accumulateToolInputStream } from './tool-input-stream.js';

interface AnthropicFileSourceParam {
  readonly file_id: string;
  readonly type: 'file';
}

interface AnthropicMappingOptions {
  readonly useBetaMessages: boolean;
}

function isAnthropicTextEditorToolDefinition(
  tool: LlmToolDefinition,
): tool is Extract<LlmToolDefinition, { readonly kind: 'anthropic_builtin' }> {
  return tool.kind === 'anthropic_builtin';
}

function isAnthropicWebSearchToolDefinition(
  tool: LlmToolDefinition,
): tool is LlmAnthropicWebSearchToolDefinition {
  return tool.kind === 'anthropic_server' && tool.name === 'web_search';
}

function isAnthropicCodeExecutionToolDefinition(
  tool: LlmToolDefinition,
): tool is LlmAnthropicCodeExecutionToolDefinition {
  return tool.kind === 'anthropic_server' && tool.name === 'code_execution';
}

function toAnthropicCacheControl(
  cacheControl: LlmCacheControl | undefined,
): CacheControlEphemeral | undefined {
  if (cacheControl === undefined) {
    return undefined;
  }

  return {
    type: cacheControl.type,
    ...(cacheControl.ttl === undefined ? {} : { ttl: cacheControl.ttl }),
  };
}

function withCacheControl<T extends object>(
  base: T,
  cacheControl: LlmCacheControl | undefined,
): T & { cache_control?: CacheControlEphemeral } {
  const mapped = toAnthropicCacheControl(cacheControl);

  return mapped === undefined ? base : { ...base, cache_control: mapped };
}

function toAnthropicInputSchema(schema: LlmToolInputSchema): Tool.InputSchema {
  const { required, ...rest } = schema;

  return {
    ...rest,
    ...(required === undefined ? {} : { required: [...required] }),
  } as Tool.InputSchema;
}

function toAnthropicCustomTool(tool: LlmCustomToolDefinition, eagerInputStreaming: boolean): Tool {
  return withCacheControl(
    {
      input_schema: toAnthropicInputSchema(tool.inputSchema),
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.inputExamples === undefined ? {} : { input_examples: [...tool.inputExamples] }),
      ...(eagerInputStreaming ? { eager_input_streaming: true as const } : {}),
    },
    tool.cacheControl,
  );
}

function toAnthropicTextEditorTool(
  tool: Extract<LlmToolDefinition, { readonly kind: 'anthropic_builtin' }>,
): ToolTextEditor20250728 {
  return withCacheControl(
    {
      name: tool.name,
      type: tool.type,
      ...(tool.maxCharacters === undefined ? {} : { max_characters: tool.maxCharacters }),
    },
    tool.cacheControl,
  );
}

function toAnthropicWebSearchTool(
  tool: LlmAnthropicWebSearchToolDefinition,
): WebSearchTool20250305 {
  return withCacheControl(
    {
      name: tool.name,
      type: tool.type,
      ...(tool.allowedDomains === undefined ? {} : { allowed_domains: [...tool.allowedDomains] }),
      ...(tool.blockedDomains === undefined ? {} : { blocked_domains: [...tool.blockedDomains] }),
      ...(tool.maxUses === undefined ? {} : { max_uses: tool.maxUses }),
      ...(tool.userLocation === undefined ? {} : { user_location: tool.userLocation }),
    },
    tool.cacheControl,
  );
}

function toAnthropicCodeExecutionTool(
  tool: LlmAnthropicCodeExecutionToolDefinition,
): CodeExecutionTool20250825 {
  return withCacheControl({ name: tool.name, type: tool.type }, tool.cacheControl);
}

export function toAnthropicTools(
  tools: readonly LlmToolDefinition[],
  eagerInputStreaming = false,
): ToolUnion[] {
  return tools.map((tool) => {
    if (isAnthropicTextEditorToolDefinition(tool)) {
      return toAnthropicTextEditorTool(tool);
    }

    if (isAnthropicWebSearchToolDefinition(tool)) {
      return toAnthropicWebSearchTool(tool);
    }

    if (isAnthropicCodeExecutionToolDefinition(tool)) {
      return toAnthropicCodeExecutionTool(tool);
    }

    return toAnthropicCustomTool(tool, eagerInputStreaming);
  });
}

function toAnthropicWebSearchCitation(citation: {
  readonly citedText: string;
  readonly encryptedIndex: string;
  readonly title: string | null;
  readonly type: 'web_search_result_location';
  readonly url: string;
}): CitationWebSearchResultLocationParam {
  return {
    cited_text: citation.citedText,
    encrypted_index: citation.encryptedIndex,
    title: citation.title,
    type: citation.type,
    url: citation.url,
  };
}

function toAnthropicCharLocationCitation(
  citation: LlmCharLocationCitation,
): CitationCharLocationParam {
  return {
    cited_text: citation.citedText,
    document_index: citation.documentIndex,
    document_title: citation.documentTitle,
    end_char_index: citation.endCharIndex,
    start_char_index: citation.startCharIndex,
    type: 'char_location',
  };
}

function toAnthropicPageLocationCitation(
  citation: LlmPageLocationCitation,
): CitationPageLocationParam {
  return {
    cited_text: citation.citedText,
    document_index: citation.documentIndex,
    document_title: citation.documentTitle,
    end_page_number: citation.endPageNumber,
    start_page_number: citation.startPageNumber,
    type: 'page_location',
  };
}

function toAnthropicContentBlockLocationCitation(
  citation: LlmContentBlockLocationCitation,
): CitationContentBlockLocationParam {
  return {
    cited_text: citation.citedText,
    document_index: citation.documentIndex,
    document_title: citation.documentTitle,
    end_block_index: citation.endBlockIndex,
    start_block_index: citation.startBlockIndex,
    type: 'content_block_location',
  };
}

function toAnthropicTextCitation(citation: LlmTextCitation): TextCitationParam {
  switch (citation.type) {
    case 'web_search_result_location': {
      return toAnthropicWebSearchCitation(citation);
    }

    case 'char_location': {
      return toAnthropicCharLocationCitation(citation);
    }

    case 'page_location': {
      return toAnthropicPageLocationCitation(citation);
    }

    case 'content_block_location': {
      return toAnthropicContentBlockLocationCitation(citation);
    }
  }
}

function toAnthropicWebSearchResultParam(
  result: LlmWebSearchResultEntry,
): WebSearchResultBlockParam {
  return {
    encrypted_content: result.encryptedContent,
    title: result.title,
    type: result.type,
    url: result.url,
    ...(result.pageAge === undefined ? {} : { page_age: result.pageAge }),
  };
}

function isLlmWebSearchResultEntries(
  content: LlmWebSearchToolResultBlock['content'],
): content is readonly LlmWebSearchResultEntry[] {
  return Array.isArray(content);
}

function toAnthropicWebSearchToolResultContent(
  block: LlmWebSearchToolResultBlock,
): WebSearchToolResultBlockParamContent {
  const content = block.content;

  if (isLlmWebSearchResultEntries(content)) {
    return content.map((entry) => toAnthropicWebSearchResultParam(entry));
  }

  const result: WebSearchToolRequestError = {
    error_code: content.errorCode as WebSearchToolRequestError['error_code'],
    type: content.type,
  };

  return result;
}

function toAnthropicImageSource(
  source: LlmImageSource,
  options: AnthropicMappingOptions,
): Base64ImageSource | URLImageSource | AnthropicFileSourceParam {
  if (source.type === 'base64') {
    return { data: source.data, media_type: source.mediaType, type: 'base64' };
  }

  if (source.type === 'url') {
    return { type: 'url', url: source.url };
  }

  if (options.useBetaMessages) {
    return { file_id: source.fileId, type: 'file' };
  }

  throw new Error(
    'File-id image sources require the beta messages namespace; supply betas on the request.',
  );
}

function toAnthropicImageBlock(
  block: LlmImageBlock,
  options: AnthropicMappingOptions,
): ImageBlockParam {
  return withCacheControl(
    {
      source: toAnthropicImageSource(block.source, options) as ImageBlockParam['source'],
      type: 'image' as const,
    },
    block.cacheControl,
  );
}

function toAnthropicContentDocumentSource(
  source: LlmContentDocumentSource,
): DocumentBlockParam['source'] {
  return {
    content: source.content.map((block) => toAnthropicTextBlockParam(block)),
    type: 'content',
  };
}

function toAnthropicDocumentSource(
  source: LlmDocumentBlock['source'],
  options: AnthropicMappingOptions,
): DocumentBlockParam['source'] | AnthropicFileSourceParam {
  if (source.type === 'base64') {
    const pdfSource: Base64PDFSource = {
      data: source.data,
      media_type: source.mediaType,
      type: 'base64',
    };

    return pdfSource;
  }

  if (source.type === 'url') {
    const urlSource: URLPDFSource = { type: 'url', url: source.url };

    return urlSource;
  }

  if (source.type === 'text') {
    const textSource: PlainTextSource = {
      data: source.data,
      media_type: source.mediaType,
      type: 'text',
    };

    return textSource;
  }

  if (source.type === 'content') {
    return toAnthropicContentDocumentSource(source);
  }

  if (options.useBetaMessages) {
    return { file_id: source.fileId, type: 'file' };
  }

  throw new Error(
    'File-id document sources require the beta messages namespace; supply betas on the request.',
  );
}

function toAnthropicDocumentBlock(
  block: LlmDocumentBlock,
  options: AnthropicMappingOptions,
): DocumentBlockParam {
  return withCacheControl(
    {
      source: toAnthropicDocumentSource(block.source, options) as DocumentBlockParam['source'],
      type: 'document' as const,
      ...(block.citations === undefined ? {} : { citations: block.citations }),
      ...(block.context === undefined ? {} : { context: block.context }),
      ...(block.title === undefined ? {} : { title: block.title }),
    },
    block.cacheControl,
  );
}

function toAnthropicThinkingBlock(block: LlmThinkingBlock): ThinkingBlockParam {
  return { signature: block.signature, thinking: block.thinking, type: 'thinking' };
}

function toAnthropicRedactedThinkingBlock(
  block: LlmRedactedThinkingBlock,
): RedactedThinkingBlockParam {
  return { data: block.data, type: 'redacted_thinking' };
}

function toAnthropicContainerUploadBlock(
  block: LlmContainerUploadBlock,
): ContainerUploadBlockParam {
  return withCacheControl(
    { file_id: block.fileId, type: 'container_upload' as const },
    block.cacheControl,
  );
}

function toAnthropicCodeExecutionResultParam(
  block: LlmCodeExecutionResultBlock,
): CodeExecutionResultBlockParam {
  return {
    content: block.content.map((output) => ({
      file_id: output.fileId,
      type: 'code_execution_output' as const,
    })),
    return_code: block.returnCode,
    stderr: block.stderr,
    stdout: block.stdout,
    type: 'code_execution_result',
  };
}

function toAnthropicCodeExecutionToolResultBlock(
  block: LlmCodeExecutionToolResultBlock,
): CodeExecutionToolResultBlockParam {
  const content = block.content;
  const contentParam =
    content.type === 'code_execution_result'
      ? toAnthropicCodeExecutionResultParam(content)
      : ({
          error_code: content.errorCode as CodeExecutionToolResultErrorCode,
          type: 'code_execution_tool_result_error',
        } satisfies CodeExecutionToolResultErrorParam);

  return {
    content: contentParam,
    tool_use_id: block.toolUseId,
    type: 'code_execution_tool_result',
  };
}

function toAnthropicBashCodeExecutionResultParam(
  block: LlmBashCodeExecutionResultBlock,
): BashCodeExecutionResultBlockParam {
  return {
    content: block.content.map((output) => ({
      file_id: output.fileId,
      type: 'bash_code_execution_output' as const,
    })),
    return_code: block.returnCode,
    stderr: block.stderr,
    stdout: block.stdout,
    type: 'bash_code_execution_result',
  };
}

function toAnthropicBashCodeExecutionToolResultBlock(
  block: LlmBashCodeExecutionToolResultBlock,
): BashCodeExecutionToolResultBlockParam {
  const content = block.content;
  const contentParam =
    content.type === 'bash_code_execution_result'
      ? toAnthropicBashCodeExecutionResultParam(content)
      : ({
          error_code: content.errorCode as BashCodeExecutionToolResultErrorCode,
          type: 'bash_code_execution_tool_result_error',
        } satisfies BashCodeExecutionToolResultErrorParam);

  return {
    content: contentParam,
    tool_use_id: block.toolUseId,
    type: 'bash_code_execution_tool_result',
  };
}

function toAnthropicTextBlockParam(block: LlmTextBlock): TextBlockParam {
  return withCacheControl(
    {
      text: block.text,
      type: 'text' as const,
      ...(block.citations === undefined
        ? {}
        : { citations: block.citations.map((citation) => toAnthropicTextCitation(citation)) }),
    },
    block.cacheControl,
  );
}

function toAnthropicServerToolUseParam(block: {
  readonly cacheControl?: LlmCacheControl;
  readonly id: string;
  readonly input: unknown;
  readonly name: ServerToolUseBlockParam['name'];
}): ServerToolUseBlockParam {
  return withCacheControl(
    { id: block.id, input: block.input, name: block.name, type: 'server_tool_use' as const },
    block.cacheControl,
  );
}

function toAnthropicContentBlock(
  block: LlmContentBlock,
  options: AnthropicMappingOptions,
): ContentBlockParam {
  if (block.type === 'text') {
    return toAnthropicTextBlockParam(block);
  }

  if (block.type === 'image') {
    return toAnthropicImageBlock(block, options);
  }

  if (block.type === 'document') {
    return toAnthropicDocumentBlock(block, options);
  }

  if (block.type === 'thinking') {
    return toAnthropicThinkingBlock(block);
  }

  if (block.type === 'redacted_thinking') {
    return toAnthropicRedactedThinkingBlock(block);
  }

  if (block.type === 'tool_use') {
    return withCacheControl(
      { id: block.id, input: block.input, name: block.name, type: 'tool_use' as const },
      block.cacheControl,
    );
  }

  if (block.type === 'tool_result') {
    return withCacheControl(
      {
        content: block.content,
        tool_use_id: block.tool_use_id,
        type: 'tool_result' as const,
        ...(block.is_error === undefined ? {} : { is_error: block.is_error }),
      },
      block.cacheControl,
    );
  }

  if (block.type === 'server_tool_use') {
    return toAnthropicServerToolUseParam({
      ...(block.cacheControl === undefined ? {} : { cacheControl: block.cacheControl }),
      id: block.id,
      input: block.input,
      name: block.name as ServerToolUseBlockParam['name'],
    });
  }

  if (block.type === 'web_search_tool_result') {
    return {
      content: toAnthropicWebSearchToolResultContent(block),
      tool_use_id: block.toolUseId,
      type: 'web_search_tool_result',
    };
  }

  if (block.type === 'code_execution_tool_result') {
    return toAnthropicCodeExecutionToolResultBlock(block);
  }

  if (block.type === 'bash_code_execution_tool_result') {
    return toAnthropicBashCodeExecutionToolResultBlock(block);
  }

  if (block.type === 'container_upload') {
    if (!options.useBetaMessages) {
      throw new Error(
        'container_upload blocks require the beta messages namespace; supply betas on the request.',
      );
    }

    return toAnthropicContainerUploadBlock(block);
  }

  throw new Error(
    'Cannot send an unknown content block to Anthropic. Update LlmContentBlock or strip unknown blocks before reuse.',
  );
}

export function toAnthropicMessages(
  messages: LlmRequest['messages'],
  options: { readonly useBetaMessages?: boolean } = {},
): MessageParam[] {
  const mappingOptions: AnthropicMappingOptions = {
    useBetaMessages: options.useBetaMessages === true,
  };

  return messages.map((message) => ({
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) => toAnthropicContentBlock(block, mappingOptions)),
    role: message.role,
  }));
}

function toAnthropicSystemPrompt(
  systemPrompt: LlmRequest['systemPrompt'],
  outputFormatInstructions: string | undefined,
): string | TextBlockParam[] | undefined {
  if (systemPrompt === undefined || systemPrompt === '') {
    return outputFormatInstructions === undefined || outputFormatInstructions === ''
      ? undefined
      : outputFormatInstructions;
  }

  if (typeof systemPrompt === 'string') {
    return outputFormatInstructions
      ? `${systemPrompt}\n\n${outputFormatInstructions}`
      : systemPrompt;
  }

  const blocks: TextBlockParam[] = systemPrompt.map((block: LlmSystemPromptBlock) =>
    withCacheControl({ text: block.text, type: 'text' as const }, block.cacheControl),
  );

  if (outputFormatInstructions) {
    blocks.push({ text: outputFormatInstructions, type: 'text' });
  }

  return blocks;
}

function toAnthropicThinkingConfig(thinking: LlmThinkingConfig): ThinkingConfigParam {
  if (thinking.type === 'enabled') {
    return { budget_tokens: thinking.budgetTokens, type: 'enabled' };
  }

  if (thinking.type === 'adaptive') {
    return {
      type: 'adaptive',
      ...(thinking.display === undefined ? {} : { display: thinking.display }),
    };
  }

  return { type: 'disabled' };
}

function fromAnthropicWebSearchCitation(
  citation: CitationsWebSearchResultLocation,
): LlmTextCitation {
  return {
    citedText: citation.cited_text,
    encryptedIndex: citation.encrypted_index,
    title: citation.title,
    type: 'web_search_result_location',
    url: citation.url,
  };
}

function fromAnthropicCharLocationCitation(
  citation: CitationCharLocation,
): LlmCharLocationCitation {
  return {
    citedText: citation.cited_text,
    documentIndex: citation.document_index,
    documentTitle: citation.document_title,
    endCharIndex: citation.end_char_index,
    ...(citation.file_id === null || citation.file_id === undefined
      ? {}
      : { fileId: citation.file_id }),
    startCharIndex: citation.start_char_index,
    type: 'char_location',
  };
}

function fromAnthropicPageLocationCitation(
  citation: CitationPageLocation,
): LlmPageLocationCitation {
  return {
    citedText: citation.cited_text,
    documentIndex: citation.document_index,
    documentTitle: citation.document_title,
    endPageNumber: citation.end_page_number,
    ...(citation.file_id === null || citation.file_id === undefined
      ? {}
      : { fileId: citation.file_id }),
    startPageNumber: citation.start_page_number,
    type: 'page_location',
  };
}

function fromAnthropicContentBlockLocationCitation(
  citation: CitationContentBlockLocation,
): LlmContentBlockLocationCitation {
  return {
    citedText: citation.cited_text,
    documentIndex: citation.document_index,
    documentTitle: citation.document_title,
    endBlockIndex: citation.end_block_index,
    ...(citation.file_id === null || citation.file_id === undefined
      ? {}
      : { fileId: citation.file_id }),
    startBlockIndex: citation.start_block_index,
    type: 'content_block_location',
  };
}

function fromAnthropicCitation(citation: TextCitation): LlmTextCitation | undefined {
  if (citation.type === 'web_search_result_location') {
    return fromAnthropicWebSearchCitation(citation);
  }

  if (citation.type === 'char_location') {
    return fromAnthropicCharLocationCitation(citation);
  }

  if (citation.type === 'page_location') {
    return fromAnthropicPageLocationCitation(citation);
  }

  if (citation.type === 'content_block_location') {
    return fromAnthropicContentBlockLocationCitation(citation);
  }

  return undefined;
}

function fromAnthropicTextBlock(block: TextBlock): LlmTextBlock {
  const citations: LlmTextCitation[] = [];

  if (block.citations !== null && block.citations !== undefined) {
    for (const citation of block.citations) {
      const mapped = fromAnthropicCitation(citation);

      if (mapped !== undefined) {
        citations.push(mapped);
      }
    }
  }

  return {
    text: block.text,
    type: 'text',
    ...(citations.length > 0 ? { citations } : {}),
  };
}

function fromAnthropicWebSearchResult(result: WebSearchResultBlock): LlmWebSearchResultEntry {
  return {
    encryptedContent: result.encrypted_content,
    ...(result.page_age === null || result.page_age === undefined
      ? {}
      : { pageAge: result.page_age }),
    title: result.title,
    type: 'web_search_result',
    url: result.url,
  };
}

function fromAnthropicWebSearchToolResult(
  block: WebSearchToolResultBlock,
): LlmWebSearchToolResultBlock {
  if (Array.isArray(block.content)) {
    return {
      content: block.content.map((result) => fromAnthropicWebSearchResult(result)),
      toolUseId: block.tool_use_id,
      type: 'web_search_tool_result',
    };
  }

  return {
    content: { errorCode: block.content.error_code, type: 'web_search_tool_result_error' },
    toolUseId: block.tool_use_id,
    type: 'web_search_tool_result',
  };
}

function fromAnthropicCodeExecutionResult(
  block: CodeExecutionResultBlock,
): LlmCodeExecutionResultBlock {
  const outputs: LlmCodeExecutionOutputBlock[] = block.content.map((output) => ({
    fileId: output.file_id,
    type: 'code_execution_output',
  }));

  return {
    content: outputs,
    returnCode: block.return_code,
    stderr: block.stderr,
    stdout: block.stdout,
    type: 'code_execution_result',
  };
}

function fromAnthropicCodeExecutionToolResult(
  block: CodeExecutionToolResultBlock,
): LlmCodeExecutionToolResultBlock {
  const content = block.content;

  if (content.type === 'code_execution_result') {
    return {
      content: fromAnthropicCodeExecutionResult(content),
      toolUseId: block.tool_use_id,
      type: 'code_execution_tool_result',
    };
  }

  if (content.type === 'code_execution_tool_result_error') {
    const errorContent: CodeExecutionToolResultError = content;

    return {
      content: { errorCode: errorContent.error_code, type: 'code_execution_tool_result_error' },
      toolUseId: block.tool_use_id,
      type: 'code_execution_tool_result',
    };
  }

  return {
    content: { errorCode: 'unavailable', type: 'code_execution_tool_result_error' },
    toolUseId: block.tool_use_id,
    type: 'code_execution_tool_result',
  };
}

function fromAnthropicBashCodeExecutionResult(
  block: BashCodeExecutionResultBlock,
): LlmBashCodeExecutionResultBlock {
  const outputs: LlmBashCodeExecutionOutputBlock[] = block.content.map((output) => ({
    fileId: output.file_id,
    type: 'bash_code_execution_output',
  }));

  return {
    content: outputs,
    returnCode: block.return_code,
    stderr: block.stderr,
    stdout: block.stdout,
    type: 'bash_code_execution_result',
  };
}

function fromAnthropicBashCodeExecutionToolResult(
  block: BashCodeExecutionToolResultBlock,
): LlmBashCodeExecutionToolResultBlock {
  const content = block.content;

  if (content.type === 'bash_code_execution_result') {
    return {
      content: fromAnthropicBashCodeExecutionResult(content),
      toolUseId: block.tool_use_id,
      type: 'bash_code_execution_tool_result',
    };
  }

  if (content.type === 'bash_code_execution_tool_result_error') {
    const errorContent: BashCodeExecutionToolResultError = content;

    return {
      content: {
        errorCode: errorContent.error_code,
        type: 'bash_code_execution_tool_result_error',
      },
      toolUseId: block.tool_use_id,
      type: 'bash_code_execution_tool_result',
    };
  }

  return {
    content: { errorCode: 'unavailable', type: 'bash_code_execution_tool_result_error' },
    toolUseId: block.tool_use_id,
    type: 'bash_code_execution_tool_result',
  };
}

function fromAnthropicContainerUpload(block: ContainerUploadBlock): LlmContainerUploadBlock {
  return { fileId: block.file_id, type: 'container_upload' };
}

function fromAnthropicThinkingBlock(block: ThinkingBlock): LlmThinkingBlock {
  return { signature: block.signature, thinking: block.thinking, type: 'thinking' };
}

function fromAnthropicRedactedThinkingBlock(
  block: RedactedThinkingBlock,
): LlmRedactedThinkingBlock {
  return { data: block.data, type: 'redacted_thinking' };
}

function fromAnthropicServerToolUse(block: ServerToolUseBlock): LlmContentBlock {
  if (
    block.name === 'web_search' ||
    block.name === 'code_execution' ||
    block.name === 'bash_code_execution'
  ) {
    return {
      id: block.id,
      input: block.input,
      name: block.name,
      type: 'server_tool_use',
    };
  }

  return { raw: block, type: 'unknown' };
}

function fromAnthropicContentBlock(block: ContentBlock): LlmContentBlock {
  if (block.type === 'text') {
    return fromAnthropicTextBlock(block);
  }

  if (block.type === 'thinking') {
    return fromAnthropicThinkingBlock(block);
  }

  if (block.type === 'redacted_thinking') {
    return fromAnthropicRedactedThinkingBlock(block);
  }

  if (block.type === 'tool_use') {
    return {
      id: block.id,
      input: block.input,
      name: block.name,
      type: 'tool_use',
    };
  }

  if (block.type === 'server_tool_use') {
    return fromAnthropicServerToolUse(block);
  }

  if (block.type === 'web_search_tool_result') {
    return fromAnthropicWebSearchToolResult(block);
  }

  if (block.type === 'code_execution_tool_result') {
    return fromAnthropicCodeExecutionToolResult(block);
  }

  if (block.type === 'bash_code_execution_tool_result') {
    return fromAnthropicBashCodeExecutionToolResult(block);
  }

  if (block.type === 'container_upload') {
    return fromAnthropicContainerUpload(block);
  }

  return { raw: block, type: 'unknown' };
}

export function contentFromAnthropicMessage(message: Message): LlmContentBlock[] {
  return message.content.map((block) => fromAnthropicContentBlock(block));
}

export function extractWebSearchSources(blocks: readonly LlmContentBlock[]): LlmWebSearchSource[] {
  const seenUrls = new Set<string>();
  const sources: LlmWebSearchSource[] = [];

  for (const block of blocks) {
    if (block.type !== 'text' || block.citations === undefined) {
      continue;
    }

    for (const citation of block.citations) {
      if (citation.type !== 'web_search_result_location') {
        continue;
      }

      if (seenUrls.has(citation.url)) {
        continue;
      }

      seenUrls.add(citation.url);
      sources.push({
        citedText: citation.citedText,
        kind: 'web_search',
        title: citation.title,
        url: citation.url,
      });
    }
  }

  return sources;
}

function documentSourceKey(
  citation: Exclude<LlmTextCitation, { type: 'web_search_result_location' }>,
): string {
  if (citation.type === 'char_location') {
    return `${citation.documentIndex}|char|${citation.startCharIndex}|${citation.endCharIndex}`;
  }

  if (citation.type === 'page_location') {
    return `${citation.documentIndex}|page|${citation.startPageNumber}|${citation.endPageNumber}`;
  }

  return `${citation.documentIndex}|block|${citation.startBlockIndex}|${citation.endBlockIndex}`;
}

export function extractDocumentSources(blocks: readonly LlmContentBlock[]): LlmDocumentSourceRef[] {
  const seen = new Set<string>();
  const sources: LlmDocumentSourceRef[] = [];

  for (const block of blocks) {
    if (block.type !== 'text' || block.citations === undefined) {
      continue;
    }

    for (const citation of block.citations) {
      if (citation.type === 'web_search_result_location') {
        continue;
      }

      const key = documentSourceKey(citation);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const base = {
        citedText: citation.citedText,
        documentIndex: citation.documentIndex,
        documentTitle: citation.documentTitle,
        kind: 'document' as const,
        ...(citation.fileId === undefined || citation.fileId === null
          ? {}
          : { fileId: citation.fileId }),
      };

      if (citation.type === 'char_location') {
        sources.push({
          ...base,
          location: {
            endCharIndex: citation.endCharIndex,
            startCharIndex: citation.startCharIndex,
            type: 'char_location',
          },
        });
      } else if (citation.type === 'page_location') {
        sources.push({
          ...base,
          location: {
            endPageNumber: citation.endPageNumber,
            startPageNumber: citation.startPageNumber,
            type: 'page_location',
          },
        });
      } else {
        sources.push({
          ...base,
          location: {
            endBlockIndex: citation.endBlockIndex,
            startBlockIndex: citation.startBlockIndex,
            type: 'content_block_location',
          },
        });
      }
    }
  }

  return sources;
}

export function extractSources(blocks: readonly LlmContentBlock[]): LlmSource[] {
  return [...extractWebSearchSources(blocks), ...extractDocumentSources(blocks)];
}

function fromAnthropicUsage(usage: Usage | undefined): LlmUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const serverToolUse: {
    -readonly [K in keyof NonNullable<LlmUsage['serverToolUse']>]?: NonNullable<
      LlmUsage['serverToolUse']
    >[K];
  } = {};
  const rawServerToolUsage = usage.server_tool_use;

  if (rawServerToolUsage) {
    if (typeof rawServerToolUsage.web_search_requests === 'number') {
      serverToolUse.webSearchRequests = rawServerToolUsage.web_search_requests;
    }

    if (typeof rawServerToolUsage.web_fetch_requests === 'number') {
      serverToolUse.webFetchRequests = rawServerToolUsage.web_fetch_requests;
    }

    const codeExecutionRequests = (rawServerToolUsage as { code_execution_requests?: number })
      .code_execution_requests;

    if (typeof codeExecutionRequests === 'number') {
      serverToolUse.codeExecutionRequests = codeExecutionRequests;
    }
  }

  const cacheCreation = usage.cache_creation;

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...(typeof usage.cache_creation_input_tokens === 'number'
      ? { cacheCreationInputTokens: usage.cache_creation_input_tokens }
      : {}),
    ...(typeof usage.cache_read_input_tokens === 'number'
      ? { cacheReadInputTokens: usage.cache_read_input_tokens }
      : {}),
    ...(cacheCreation
      ? {
          cacheCreation: {
            ephemeral1hInputTokens: cacheCreation.ephemeral_1h_input_tokens,
            ephemeral5mInputTokens: cacheCreation.ephemeral_5m_input_tokens,
          },
        }
      : {}),
    ...(Object.keys(serverToolUse).length > 0 ? { serverToolUse } : {}),
  };
}

function createLlmResponse(message: Message, text: string): LlmResponse {
  const content = contentFromAnthropicMessage(message);
  const sources = extractSources(content);
  const usage = fromAnthropicUsage(message.usage);

  return {
    content,
    raw: message,
    ...(sources.length > 0 ? { sources } : {}),
    ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
    text,
    ...(usage === undefined ? {} : { usage }),
  };
}

function textFromBlocks(blocks: readonly LlmContentBlock[]): string {
  return blocks
    .filter((b): b is LlmTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function validateThinkingConfig(request: LlmRequest): void {
  if (request.thinking?.type !== 'enabled') {
    return;
  }

  if (request.thinking.budgetTokens < 1024) {
    throw new Error('Extended thinking budget_tokens must be at least 1024.');
  }

  if (request.thinking.budgetTokens >= request.maxTokens) {
    throw new Error('Extended thinking budget_tokens must be less than maxTokens.');
  }

  if (request.temperature !== undefined) {
    throw new Error('Extended thinking is incompatible with temperature.');
  }

  if (request.outputFormat?.assistantPrefill) {
    throw new Error('Extended thinking is incompatible with assistant prefill.');
  }
}

interface AnthropicMessagesNamespace {
  readonly create: Anthropic['messages']['create'];
  readonly stream: Anthropic['messages']['stream'];
}

function resolveMessagesNamespace(
  client: Anthropic,
  betas: readonly string[] | undefined,
): AnthropicMessagesNamespace {
  if (betas !== undefined && betas.length > 0) {
    const betaMessages = client.beta.messages as unknown as AnthropicMessagesNamespace;

    return betaMessages;
  }

  return client.messages;
}

export function createAnthropicProvider(client: Anthropic): LlmProvider {
  return {
    async createMessage(request: LlmRequest): Promise<LlmResponse> {
      validateThinkingConfig(request);
      const useBetaMessages = request.betas !== undefined && request.betas.length > 0;
      const requestMessages = toAnthropicMessages(request.messages, { useBetaMessages });
      const jsonSchema = request.outputFormat?.jsonSchema;
      const assistantPrefill =
        jsonSchema === undefined ? (request.outputFormat?.assistantPrefill ?? '') : '';
      const responseSuffix =
        jsonSchema === undefined ? (request.outputFormat?.responseSuffix ?? '') : '';
      const system = toAnthropicSystemPrompt(
        request.systemPrompt,
        request.outputFormat?.instructions,
      );

      if (assistantPrefill) {
        requestMessages.push({ content: assistantPrefill, role: 'assistant' });
      }

      const streamEnabled = request.stream ?? true;
      const useFineGrainedStreaming =
        streamEnabled &&
        request.fineGrainedToolStreaming === true &&
        (request.tools?.length ?? 0) > 0;

      const params = {
        max_tokens: request.maxTokens,
        messages: requestMessages,
        model: request.model,
        ...(request.betas && request.betas.length > 0 ? { betas: [...request.betas] } : {}),
        ...(request.thinking === undefined
          ? {}
          : { thinking: toAnthropicThinkingConfig(request.thinking) }),
        ...(request.outputFormat?.stopSequences?.length && jsonSchema === undefined
          ? { stop_sequences: [...request.outputFormat.stopSequences] }
          : {}),
        ...(system === undefined ? {} : { system }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.tools?.length
          ? { tools: toAnthropicTools(request.tools, useFineGrainedStreaming) }
          : {}),
        ...(jsonSchema === undefined
          ? {}
          : { output_config: { format: { schema: jsonSchema, type: 'json_schema' as const } } }),
      };
      const messages = resolveMessagesNamespace(client, request.betas);

      if (useFineGrainedStreaming) {
        if (assistantPrefill && request.onTextDelta) {
          request.onTextDelta(assistantPrefill);
        }

        const stream = messages.stream(params);
        const { blocks, stopReason } = await accumulateToolInputStream(
          stream,
          request.onTextDelta,
          request.onToolInputStreamEvent,
        );
        const rawMessage = await stream.finalMessage();
        const text = `${assistantPrefill}${textFromBlocks(blocks)}${responseSuffix}`;

        if (responseSuffix && request.onTextDelta) {
          request.onTextDelta(responseSuffix);
        }

        const resolvedStopReason = stopReason ?? rawMessage.stop_reason ?? undefined;
        const sources = extractSources(blocks);
        const usage = fromAnthropicUsage(rawMessage.usage);

        return {
          content: blocks,
          raw: rawMessage,
          ...(sources.length > 0 ? { sources } : {}),
          ...(resolvedStopReason === undefined ? {} : { stopReason: resolvedStopReason }),
          text,
          ...(usage === undefined ? {} : { usage }),
        };
      }

      if (streamEnabled) {
        const stream = messages.stream(params);

        if (assistantPrefill && request.onTextDelta) {
          request.onTextDelta(assistantPrefill);
        }

        if (request.onTextDelta) {
          stream.on('text', request.onTextDelta);
        }

        const message = await stream.finalMessage();
        const text = `${assistantPrefill}${textFromMessage(message)}${responseSuffix}`;

        if (responseSuffix && request.onTextDelta) {
          request.onTextDelta(responseSuffix);
        }

        return createLlmResponse(message, text);
      }

      const message = await messages.create(params);

      return createLlmResponse(
        message,
        `${assistantPrefill}${textFromMessage(message)}${responseSuffix}`,
      );
    },
  };
}
