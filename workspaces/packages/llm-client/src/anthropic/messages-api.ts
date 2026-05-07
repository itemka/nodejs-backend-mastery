import type Anthropic from '@anthropic-ai/sdk';
import type {
  CitationWebSearchResultLocationParam,
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageParam,
  ServerToolUseBlock,
  TextBlock,
  TextCitation,
  Tool,
  ToolTextEditor20250728,
  ToolUnion,
  WebSearchResultBlock,
  WebSearchResultBlockParam,
  WebSearchTool20250305,
  WebSearchToolRequestError,
  WebSearchToolResultBlock,
  WebSearchToolResultBlockParamContent,
} from '@anthropic-ai/sdk/resources/messages/messages';

import type {
  LlmAnthropicWebSearchToolDefinition,
  LlmContentBlock,
  LlmCustomToolDefinition,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmTextBlock,
  LlmTextCitation,
  LlmToolDefinition,
  LlmToolInputSchema,
  LlmWebSearchResultEntry,
  LlmWebSearchSource,
  LlmWebSearchToolResultBlock,
} from '../types.js';
import { textFromMessage } from './text.js';
import { accumulateToolInputStream } from './tool-input-stream.js';

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

function toAnthropicInputSchema(schema: LlmToolInputSchema): Tool.InputSchema {
  const { required, ...rest } = schema;

  return {
    ...rest,
    ...(required === undefined ? {} : { required: [...required] }),
  } as Tool.InputSchema;
}

function toAnthropicCustomTool(tool: LlmCustomToolDefinition, eagerInputStreaming: boolean): Tool {
  return {
    input_schema: toAnthropicInputSchema(tool.inputSchema),
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.inputExamples === undefined ? {} : { input_examples: [...tool.inputExamples] }),
    ...(eagerInputStreaming ? { eager_input_streaming: true as const } : {}),
  };
}

function toAnthropicTextEditorTool(
  tool: Extract<LlmToolDefinition, { readonly kind: 'anthropic_builtin' }>,
): ToolTextEditor20250728 {
  return {
    name: tool.name,
    type: tool.type,
    ...(tool.maxCharacters === undefined ? {} : { max_characters: tool.maxCharacters }),
  };
}

function toAnthropicWebSearchTool(
  tool: LlmAnthropicWebSearchToolDefinition,
): WebSearchTool20250305 {
  return {
    name: tool.name,
    type: tool.type,
    ...(tool.allowedDomains === undefined ? {} : { allowed_domains: [...tool.allowedDomains] }),
    ...(tool.blockedDomains === undefined ? {} : { blocked_domains: [...tool.blockedDomains] }),
    ...(tool.maxUses === undefined ? {} : { max_uses: tool.maxUses }),
    ...(tool.userLocation === undefined ? {} : { user_location: tool.userLocation }),
  };
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

    return toAnthropicCustomTool(tool, eagerInputStreaming);
  });
}

function toAnthropicTextCitation(citation: LlmTextCitation): CitationWebSearchResultLocationParam {
  return {
    cited_text: citation.citedText,
    encrypted_index: citation.encryptedIndex,
    title: citation.title,
    type: citation.type,
    url: citation.url,
  };
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

function toAnthropicContentBlock(block: LlmContentBlock): ContentBlockParam {
  if (block.type === 'text') {
    return {
      text: block.text,
      type: 'text',
      ...(block.citations === undefined
        ? {}
        : { citations: block.citations.map((citation) => toAnthropicTextCitation(citation)) }),
    };
  }

  if (block.type === 'tool_use') {
    return {
      id: block.id,
      input: block.input,
      name: block.name,
      type: 'tool_use',
    };
  }

  if (block.type === 'tool_result') {
    return {
      content: block.content,
      tool_use_id: block.tool_use_id,
      type: 'tool_result',
      ...(block.is_error === undefined ? {} : { is_error: block.is_error }),
    };
  }

  if (block.type === 'server_tool_use') {
    return {
      id: block.id,
      input: block.input,
      name: block.name,
      type: 'server_tool_use',
    };
  }

  if (block.type === 'web_search_tool_result') {
    return {
      content: toAnthropicWebSearchToolResultContent(block),
      tool_use_id: block.toolUseId,
      type: 'web_search_tool_result',
    };
  }

  throw new Error(
    'Cannot send an unknown content block to Anthropic. Update LlmContentBlock or strip unknown blocks before reuse.',
  );
}

export function toAnthropicMessages(messages: LlmRequest['messages']): MessageParam[] {
  return messages.map((message) => ({
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) => toAnthropicContentBlock(block)),
    role: message.role,
  }));
}

function fromAnthropicCitation(citation: TextCitation): LlmTextCitation | undefined {
  if (citation.type !== 'web_search_result_location') {
    return undefined;
  }

  return {
    citedText: citation.cited_text,
    encryptedIndex: citation.encrypted_index,
    title: citation.title,
    type: 'web_search_result_location',
    url: citation.url,
  };
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

function fromAnthropicServerToolUse(block: ServerToolUseBlock): LlmContentBlock {
  if (block.name === 'web_search') {
    return {
      id: block.id,
      input: block.input,
      name: 'web_search',
      type: 'server_tool_use',
    };
  }

  return { raw: block, type: 'unknown' };
}

function fromAnthropicContentBlock(block: ContentBlock): LlmContentBlock {
  if (block.type === 'text') {
    return fromAnthropicTextBlock(block);
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

function createLlmResponse(message: Message, text: string): LlmResponse {
  const content = contentFromAnthropicMessage(message);
  const sources = extractWebSearchSources(content);

  return {
    content,
    raw: message,
    ...(sources.length > 0 ? { sources } : {}),
    ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
    text,
  };
}

function textFromBlocks(blocks: readonly LlmContentBlock[]): string {
  return blocks
    .filter((b): b is LlmTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export function createAnthropicProvider(client: Anthropic): LlmProvider {
  return {
    async createMessage(request: LlmRequest): Promise<LlmResponse> {
      const requestMessages = toAnthropicMessages(request.messages);
      const jsonSchema = request.outputFormat?.jsonSchema;
      const assistantPrefill =
        jsonSchema === undefined ? (request.outputFormat?.assistantPrefill ?? '') : '';
      const responseSuffix =
        jsonSchema === undefined ? (request.outputFormat?.responseSuffix ?? '') : '';
      const system = [request.systemPrompt, request.outputFormat?.instructions]
        .filter(Boolean)
        .join('\n\n');

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
        ...(request.outputFormat?.stopSequences?.length && jsonSchema === undefined
          ? { stop_sequences: [...request.outputFormat.stopSequences] }
          : {}),
        ...(system ? { system } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.tools?.length
          ? { tools: toAnthropicTools(request.tools, useFineGrainedStreaming) }
          : {}),
        ...(jsonSchema === undefined
          ? {}
          : { output_config: { format: { schema: jsonSchema, type: 'json_schema' as const } } }),
      };

      if (useFineGrainedStreaming) {
        if (assistantPrefill && request.onTextDelta) {
          request.onTextDelta(assistantPrefill);
        }

        const stream = client.messages.stream(params);
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
        const sources = extractWebSearchSources(blocks);

        return {
          content: blocks,
          raw: rawMessage,
          ...(sources.length > 0 ? { sources } : {}),
          ...(resolvedStopReason === undefined ? {} : { stopReason: resolvedStopReason }),
          text,
        };
      }

      if (streamEnabled) {
        const stream = client.messages.stream(params);

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

      const message = await client.messages.create(params);

      return createLlmResponse(
        message,
        `${assistantPrefill}${textFromMessage(message)}${responseSuffix}`,
      );
    },
  };
}
