import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageParam,
  Tool,
  ToolTextEditor20250728,
  ToolUnion,
} from '@anthropic-ai/sdk/resources/messages/messages';

import type {
  LlmContentBlock,
  LlmCustomToolDefinition,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmTextBlock,
  LlmToolDefinition,
  LlmToolInputSchema,
} from '../types.js';
import { textFromMessage } from './text.js';
import { accumulateToolInputStream } from './tool-input-stream.js';

function isAnthropicBuiltinToolDefinition(
  tool: LlmToolDefinition,
): tool is Extract<LlmToolDefinition, { readonly kind: 'anthropic_builtin' }> {
  return tool.kind === 'anthropic_builtin';
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

export function toAnthropicTools(
  tools: readonly LlmToolDefinition[],
  eagerInputStreaming = false,
): ToolUnion[] {
  return tools.map((tool) => {
    if (isAnthropicBuiltinToolDefinition(tool)) {
      return toAnthropicTextEditorTool(tool);
    }

    return toAnthropicCustomTool(tool, eagerInputStreaming);
  });
}

function toAnthropicContentBlock(block: LlmContentBlock): ContentBlockParam {
  if (block.type === 'text') {
    return { text: block.text, type: 'text' };
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

function fromAnthropicContentBlock(block: ContentBlock): LlmContentBlock {
  if (block.type === 'text') {
    return { text: block.text, type: 'text' };
  }

  if (block.type === 'tool_use') {
    return {
      id: block.id,
      input: block.input,
      name: block.name,
      type: 'tool_use',
    };
  }

  return { raw: block, type: 'unknown' };
}

export function contentFromAnthropicMessage(message: Message): LlmContentBlock[] {
  return message.content.map((block) => fromAnthropicContentBlock(block));
}

function createLlmResponse(message: Message, text: string): LlmResponse {
  return {
    content: contentFromAnthropicMessage(message),
    raw: message,
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

        return {
          content: blocks,
          raw: rawMessage,
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
