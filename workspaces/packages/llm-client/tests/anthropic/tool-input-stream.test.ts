import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages';
import { describe, expect, it, vi } from 'vitest';

import { accumulateToolInputStream } from '../../src/anthropic/tool-input-stream.js';
import type { LlmToolInputStreamEvent } from '../../src/types.js';

function makeStream(events: MessageStreamEvent[]): AsyncIterable<MessageStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;

      return {
        next() {
          const event = events[index++];

          return Promise.resolve(
            event === undefined
              ? { done: true as const, value: undefined }
              : { done: false, value: event },
          );
        },
      };
    },
  };
}

describe('accumulateToolInputStream', () => {
  it('accumulates multiple input_json_delta chunks into a single tool_use block', async () => {
    const stream = makeStream([
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_1',
          input: {},
          name: 'get_current_datetime',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{"for', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      {
        delta: { partial_json: 'mat":"iso"}', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
      {
        delta: {
          container: null,
          stop_details: null,
          stop_reason: 'tool_use',
          stop_sequence: null,
        },
        type: 'message_delta',
        usage: { output_tokens: 10 },
      },
    ] as unknown as MessageStreamEvent[]);

    const { blocks, stopReason } = await accumulateToolInputStream(stream);

    expect(blocks).toEqual([
      { id: 'toolu_1', input: { format: 'iso' }, name: 'get_current_datetime', type: 'tool_use' },
    ]);
    expect(stopReason).toBe('tool_use');
  });

  it('tracks multiple tool-use blocks separately by content block index', async () => {
    const stream = makeStream([
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_1',
          input: {},
          name: 'tool_a',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_2',
          input: {},
          name: 'tool_b',
          type: 'tool_use',
        },
        index: 1,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{"x":1}', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      {
        delta: { partial_json: '{"y":2}', type: 'input_json_delta' },
        index: 1,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
      { index: 1, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    const { blocks } = await accumulateToolInputStream(stream);

    expect(blocks).toEqual([
      { id: 'toolu_1', input: { x: 1 }, name: 'tool_a', type: 'tool_use' },
      { id: 'toolu_2', input: { y: 2 }, name: 'tool_b', type: 'tool_use' },
    ]);
  });

  it('creates a safe invalid-input marker when JSON is malformed and exposes no raw JSON in message', async () => {
    const stream = makeStream([
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_bad',
          input: {},
          name: 'bad_tool',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{not valid', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    const { blocks } = await accumulateToolInputStream(stream);

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe('tool_use');

    if (block?.type === 'tool_use') {
      expect(block.inputError).toEqual({
        code: 'invalid_json',
        message: 'Invalid tool input JSON received from provider.',
      });
      expect(block.input).toEqual({});
      expect(JSON.stringify(block.inputError)).not.toContain('not valid');
    }
  });

  it('creates a safe invalid-input marker when a tool-use block never stops', async () => {
    const events: LlmToolInputStreamEvent[] = [];
    const stream = makeStream([
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_cutoff',
          input: {},
          name: 'cutoff_tool',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{"format":"iso"', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      {
        delta: {
          container: null,
          stop_details: null,
          stop_reason: 'tool_use',
          stop_sequence: null,
        },
        type: 'message_delta',
        usage: { output_tokens: 10 },
      },
    ] as unknown as MessageStreamEvent[]);

    const { blocks, stopReason } = await accumulateToolInputStream(stream, undefined, (event) => {
      events.push(event);
    });

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe('tool_use');

    if (block?.type === 'tool_use') {
      expect(block.inputError).toEqual({
        code: 'invalid_json',
        message: 'Invalid tool input JSON received from provider.',
      });
      expect(block.input).toEqual({});
      expect(JSON.stringify(block.inputError)).not.toContain('format');
    }

    expect(stopReason).toBe('tool_use');
    expect(events).toEqual([
      { name: 'cutoff_tool', type: 'tool_input_stream_started' },
      { name: 'cutoff_tool', type: 'tool_input_stream_failed' },
    ]);
  });

  it('fires tool_input_stream_started and tool_input_stream_completed events', async () => {
    const events: LlmToolInputStreamEvent[] = [];
    const stream = makeStream([
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_1',
          input: {},
          name: 'my_tool',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{}', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    await accumulateToolInputStream(stream, undefined, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { name: 'my_tool', type: 'tool_input_stream_started' },
      { name: 'my_tool', type: 'tool_input_stream_completed' },
    ]);
  });

  it('fires tool_input_stream_failed when JSON is invalid', async () => {
    const events: LlmToolInputStreamEvent[] = [];
    const stream = makeStream([
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_1',
          input: {},
          name: 'bad_tool',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{broken', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    await accumulateToolInputStream(stream, undefined, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { name: 'bad_tool', type: 'tool_input_stream_started' },
      { name: 'bad_tool', type: 'tool_input_stream_failed' },
    ]);
  });

  it('accumulates text deltas and calls onTextDelta for each chunk', async () => {
    const chunks: string[] = [];
    const stream = makeStream([
      { content_block: { text: '', type: 'text' }, index: 0, type: 'content_block_start' },
      { delta: { text: 'Hello ', type: 'text_delta' }, index: 0, type: 'content_block_delta' },
      { delta: { text: 'world', type: 'text_delta' }, index: 0, type: 'content_block_delta' },
      { index: 0, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    const { blocks } = await accumulateToolInputStream(stream, (text) => {
      chunks.push(text);
    });

    expect(blocks).toEqual([{ text: 'Hello world', type: 'text' }]);
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('preserves unknown content blocks as unknown type', async () => {
    const thinkingBlock = { signature: 'sig', thinking: 'reasoning...', type: 'thinking' };
    const stream = makeStream([
      { content_block: thinkingBlock, index: 0, type: 'content_block_start' },
      { index: 0, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    const { blocks } = await accumulateToolInputStream(stream);

    expect(blocks).toEqual([{ raw: thinkingBlock, type: 'unknown' }]);
  });

  it('includes parsed tool_use blocks, text blocks, and stopReason in the result', async () => {
    const stream = makeStream([
      { content_block: { text: '', type: 'text' }, index: 0, type: 'content_block_start' },
      {
        delta: { text: 'Let me check.', type: 'text_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_1',
          input: {},
          name: 'get_time',
          type: 'tool_use',
        },
        index: 1,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{"tz":"UTC"}', type: 'input_json_delta' },
        index: 1,
        type: 'content_block_delta',
      },
      { index: 1, type: 'content_block_stop' },
      {
        delta: {
          container: null,
          stop_details: null,
          stop_reason: 'tool_use',
          stop_sequence: null,
        },
        type: 'message_delta',
        usage: { output_tokens: 5 },
      },
    ] as unknown as MessageStreamEvent[]);

    const { blocks, stopReason } = await accumulateToolInputStream(stream);

    expect(blocks).toEqual([
      { text: 'Let me check.', type: 'text' },
      { id: 'toolu_1', input: { tz: 'UTC' }, name: 'get_time', type: 'tool_use' },
    ]);
    expect(stopReason).toBe('tool_use');
  });

  it('ignores unknown event types gracefully', async () => {
    const onToolEvent = vi.fn();
    const stream = makeStream([
      {
        message: {
          content: [],
          id: 'msg_1',
          model: 'm',
          role: 'assistant',
          stop_reason: null,
          stop_sequence: null,
          type: 'message',
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
        type: 'message_start',
      },
      {
        content_block: {
          caller: { type: 'direct' },
          id: 'toolu_1',
          input: {},
          name: 'tool_x',
          type: 'tool_use',
        },
        index: 0,
        type: 'content_block_start',
      },
      {
        delta: { partial_json: '{"ok":true}', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      { index: 0, type: 'content_block_stop' },
    ] as unknown as MessageStreamEvent[]);

    const { blocks } = await accumulateToolInputStream(stream, undefined, onToolEvent);

    expect(blocks).toEqual([
      { id: 'toolu_1', input: { ok: true }, name: 'tool_x', type: 'tool_use' },
    ]);
  });
});
