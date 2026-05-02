import type Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages';

import type { LlmProvider, LlmRequest, LlmResponse } from '../types.js';
import { textFromMessage } from './text.js';

export function createAnthropicProvider(client: Anthropic): LlmProvider {
  return {
    async createMessage(request: LlmRequest): Promise<LlmResponse> {
      const requestMessages: MessageParam[] = request.messages.map((message) => ({ ...message }));
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

      const params = {
        max_tokens: request.maxTokens,
        messages: requestMessages,
        model: request.model,
        ...(request.outputFormat?.stopSequences?.length && jsonSchema === undefined
          ? { stop_sequences: [...request.outputFormat.stopSequences] }
          : {}),
        ...(system ? { system } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(jsonSchema === undefined
          ? {}
          : { output_config: { format: { schema: jsonSchema, type: 'json_schema' as const } } }),
      };

      if (request.stream ?? true) {
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

        return {
          raw: message,
          text,
        };
      }

      const message = await client.messages.create(params);

      return {
        raw: message,
        text: `${assistantPrefill}${textFromMessage(message)}${responseSuffix}`,
      };
    },
  };
}
