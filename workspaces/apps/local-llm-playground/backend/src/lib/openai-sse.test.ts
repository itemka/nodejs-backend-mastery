import { describe, expect, it } from 'vitest';

import { extractSseEvents, parseOpenAiStreamEvent } from './openai-sse.js';

describe('backend/lib/openai-sse', () => {
  it('extracts complete events and keeps the trailing remainder', () => {
    const extracted = extractSseEvents(
      'event: delta\ndata: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
        'event: delta\ndata: {"choices":[{"delta":{"content":" world"}}]}',
    );

    expect(extracted.events).toHaveLength(1);
    expect(extracted.remainder).toContain('world');
  });

  it('parses streamed content chunks', () => {
    const parsed = parseOpenAiStreamEvent(
      '{"model":"qwen2.5:7b","choices":[{"delta":{"content":"Hello"}}]}',
    );

    expect(parsed.done).toBe(false);
    expect(parsed.deltaText).toBe('Hello');
    expect(parsed.model).toBe('qwen2.5:7b');
  });

  it('handles the OpenAI done sentinel', () => {
    expect(parseOpenAiStreamEvent('[DONE]')).toEqual({
      deltaText: '',
      done: true,
    });
  });
});
