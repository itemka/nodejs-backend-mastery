import type { LlmProvider, LlmRequest, LlmResponse } from '@workspaces/packages/llm-client';
import { describe, expect, it, vi } from 'vitest';

import { createChatService } from '../../src/chat/service.js';
import type { Messages } from '../../src/chat/types.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';
import { buildLlmChatTools } from '../../src/tools/registry.js';
import type { SearchDocsClient } from '../../src/tools/search-docs-client.js';
import { createAppToolExecutionContext } from '../../src/tools/types.js';

function createSequenceProvider(responses: readonly LlmResponse[]): {
  calls: LlmRequest[];
  provider: LlmProvider;
} {
  const calls: LlmRequest[] = [];
  const remaining = [...responses];
  const provider: LlmProvider = {
    createMessage(request) {
      calls.push({
        ...request,
        messages: request.messages.map((message) => ({
          ...message,
          content:
            typeof message.content === 'string'
              ? message.content
              : message.content.map((block) => ({ ...block })),
        })),
      });

      const response = remaining.shift();

      if (response === undefined) {
        throw new Error('No fake response configured');
      }

      return Promise.resolve(response);
    },
  };

  return { calls, provider };
}

describe('search_docs end-to-end via chat service', () => {
  it('routes a tool_use call through the fake RAG client and returns the final answer', async () => {
    const messages: Messages = [];
    const ragClient: SearchDocsClient = {
      search: vi.fn().mockResolvedValue({
        query: 'INC-2023-Q4-011',
        results: [
          {
            chunkId: 'sample-report#sec0',
            chunkIndex: 0,
            content: 'Incident INC-2023-Q4-011 hit the payment gateway after a deploy.',
            documentId: 'sample-report',
            fusedScore: 0.5,
            sectionTitle: 'Incident INC-2023-Q4-011',
            sourceName: 'sample-report.md',
            sourcePath: '/repo/sample-documents/sample-report.md',
          },
        ],
        topK: 5,
      }),
    };
    const { provider } = createSequenceProvider([
      {
        content: [
          {
            id: 'toolu_1',
            input: { query: 'INC-2023-Q4-011', topK: 5 },
            name: 'search_docs',
            type: 'tool_use',
          },
        ],
        raw: { stop_reason: 'tool_use' },
        stopReason: 'tool_use',
        text: '',
      },
      {
        content: [
          {
            text: 'INC-2023-Q4-011 affected the payment gateway after a deploy.',
            type: 'text',
          },
        ],
        raw: { stop_reason: 'end_turn' },
        stopReason: 'end_turn',
        text: 'INC-2023-Q4-011 affected the payment gateway after a deploy.',
      },
    ]);

    const service = createChatService({
      model: DEFAULT_MODEL,
      provider,
      toolContext: createAppToolExecutionContext({ searchDocsClient: ragClient }),
      tools: buildLlmChatTools({ ragSearchEnabled: true }),
    });

    const answer = await service.sendUserTurn(messages, 'What happened in INC-2023-Q4-011?', {
      toolsEnabled: true,
    });

    expect(answer).toBe('INC-2023-Q4-011 affected the payment gateway after a deploy.');
    expect(vi.mocked(ragClient.search)).toHaveBeenCalledWith({ query: 'INC-2023-Q4-011', topK: 5 });

    const toolResultMessage = messages[2];
    expect(toolResultMessage).toBeDefined();

    if (toolResultMessage !== undefined && typeof toolResultMessage.content !== 'string') {
      const toolResult = toolResultMessage.content[0];
      expect(toolResult).toMatchObject({
        tool_use_id: 'toolu_1',
        type: 'tool_result',
      });

      if (toolResult !== undefined && 'content' in toolResult) {
        expect(typeof toolResult.content).toBe('string');
        expect(toolResult.content as string).toContain('INC-2023-Q4-011');
      }
    }
  });

  it('returns a sanitized error when the RAG service rejects the request', async () => {
    const messages: Messages = [];
    const ragClient: SearchDocsClient = {
      search: vi.fn().mockRejectedValue(new Error('rag down: stack trace details')),
    };
    const { provider } = createSequenceProvider([
      {
        content: [
          {
            id: 'toolu_1',
            input: { query: 'q' },
            name: 'search_docs',
            type: 'tool_use',
          },
        ],
        raw: { stop_reason: 'tool_use' },
        stopReason: 'tool_use',
        text: '',
      },
      {
        content: [{ text: 'recovered', type: 'text' }],
        raw: { stop_reason: 'end_turn' },
        stopReason: 'end_turn',
        text: 'recovered',
      },
    ]);

    const service = createChatService({
      model: DEFAULT_MODEL,
      provider,
      toolContext: createAppToolExecutionContext({ searchDocsClient: ragClient }),
      tools: buildLlmChatTools({ ragSearchEnabled: true }),
    });

    const answer = await service.sendUserTurn(messages, 'q', { toolsEnabled: true });

    expect(answer).toBe('recovered');

    const toolResultMessage = messages[2];

    if (toolResultMessage !== undefined && typeof toolResultMessage.content !== 'string') {
      const toolResult = toolResultMessage.content[0];
      expect(toolResult).toMatchObject({ is_error: true, type: 'tool_result' });
    }
  });
});
