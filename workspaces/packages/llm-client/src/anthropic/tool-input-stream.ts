import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages';

import type { LlmContentBlock, LlmToolInputStreamEvent } from '../types.js';

interface TextState {
  buffer: string;
  type: 'text';
}

interface ToolUseState {
  id: string;
  jsonBuffer: string;
  name: string;
  parseError?: true;
  parsed?: unknown;
  stopped?: true;
  type: 'tool_use';
}

interface UnknownState {
  deltas: unknown[];
  raw: unknown;
  type: 'unknown';
}

type BlockState = TextState | ToolUseState | UnknownState;

export interface ToolStreamAccumulation {
  readonly blocks: readonly LlmContentBlock[];
  readonly stopReason: string | undefined;
}

export async function accumulateToolInputStream(
  stream: AsyncIterable<MessageStreamEvent>,
  onTextDelta?: (text: string) => void,
  onToolInputStreamEvent?: (event: LlmToolInputStreamEvent) => void,
): Promise<ToolStreamAccumulation> {
  const blockStates = new Map<number, BlockState>();
  let stopReason: string | undefined;

  for await (const event of stream) {
    switch (event.type) {
      case 'content_block_start': {
        const { content_block, index } = event;

        if (content_block.type === 'text') {
          blockStates.set(index, { buffer: '', type: 'text' });
        } else if (content_block.type === 'tool_use') {
          blockStates.set(index, {
            id: content_block.id,
            jsonBuffer: '',
            name: content_block.name,
            type: 'tool_use',
          });
          onToolInputStreamEvent?.({ name: content_block.name, type: 'tool_input_stream_started' });
        } else {
          blockStates.set(index, { deltas: [], raw: content_block, type: 'unknown' });
        }

        break;
      }

      case 'content_block_delta': {
        const state = blockStates.get(event.index);

        if (state?.type === 'text' && event.delta.type === 'text_delta') {
          state.buffer += event.delta.text;
          onTextDelta?.(event.delta.text);
        } else if (state?.type === 'tool_use' && event.delta.type === 'input_json_delta') {
          state.jsonBuffer += event.delta.partial_json;
        } else if (state?.type === 'unknown') {
          state.deltas.push(event.delta);
        }

        break;
      }

      case 'content_block_stop': {
        const state = blockStates.get(event.index);

        if (state?.type === 'tool_use') {
          state.stopped = true;
          const rawJson = state.jsonBuffer.trim();

          try {
            state.parsed = rawJson === '' ? {} : (JSON.parse(rawJson) as unknown);
            onToolInputStreamEvent?.({ name: state.name, type: 'tool_input_stream_completed' });
          } catch {
            state.parseError = true;
            onToolInputStreamEvent?.({ name: state.name, type: 'tool_input_stream_failed' });
          }
        }

        break;
      }

      case 'message_delta': {
        stopReason = event.delta.stop_reason ?? undefined;
        break;
      }

      default: {
        break;
      }
    }
  }

  for (const state of blockStates.values()) {
    if (state.type === 'tool_use' && state.stopped !== true && state.parseError !== true) {
      state.parseError = true;
      onToolInputStreamEvent?.({ name: state.name, type: 'tool_input_stream_failed' });
    }
  }

  const blocks: LlmContentBlock[] = [];
  const sortedIndices = [...blockStates.keys()].toSorted((a, b) => a - b);

  for (const index of sortedIndices) {
    const state = blockStates.get(index);

    if (state === undefined) {
      continue;
    }

    if (state.type === 'text') {
      blocks.push({ text: state.buffer, type: 'text' });
    } else if (state.type === 'tool_use') {
      if (state.parseError === true) {
        blocks.push({
          id: state.id,
          input: {},
          inputError: {
            code: 'invalid_json',
            message: 'Invalid tool input JSON received from provider.',
          },
          name: state.name,
          type: 'tool_use',
        });
      } else {
        blocks.push({
          id: state.id,
          input: state.parsed ?? {},
          name: state.name,
          type: 'tool_use',
        });
      }
    } else {
      blocks.push({ raw: { block: state.raw, deltas: state.deltas }, type: 'unknown' });
    }
  }

  return { blocks, stopReason };
}
