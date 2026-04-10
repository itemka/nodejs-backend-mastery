import { AppError } from './app-error.js';

interface OpenAiChunkPayload {
  choices?: {
    delta?: {
      content?:
        | string
        | {
            text?: string;
            type?: string;
          }[]
        | undefined;
    };
  }[];
  model?: string;
}

type OpenAiMessageContent =
  | string
  | {
      text?: string;
      type?: string;
    }[]
  | undefined;

export interface ParsedStreamChunk {
  deltaText: string;
  done: boolean;
  model?: string | undefined;
}

export function extractSseEvents(buffer: string): {
  events: string[];
  remainder: string;
} {
  // Ollama/OpenAI streams arrive as partial text, so we keep unfinished tail data for the next chunk.
  const normalized = buffer.replaceAll('\r\n', '\n');
  const chunks = normalized.split('\n\n');

  if (chunks.length === 1) {
    return {
      events: [],
      remainder: normalized,
    };
  }

  const remainder = chunks.pop() ?? '';
  const events = chunks
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean);

  return {
    events,
    remainder,
  };
}

export function parseOpenAiStreamEvent(rawEvent: string): ParsedStreamChunk {
  // The OpenAI-compatible stream ends with a sentinel instead of a final JSON object.
  if (rawEvent === '[DONE]') {
    return {
      deltaText: '',
      done: true,
    };
  }

  let payload: OpenAiChunkPayload;

  try {
    payload = JSON.parse(rawEvent) as OpenAiChunkPayload;
  } catch (error) {
    throw new AppError({
      cause: error,
      code: 'OLLAMA_STREAM_PARSE_ERROR',
      message: 'Could not parse the streamed Ollama response.',
      statusCode: 502,
    });
  }

  const messageContent = payload.choices?.[0]?.delta?.content;

  return {
    deltaText: normalizeMessageContent(messageContent),
    done: false,
    model: payload.model,
  };
}

function normalizeMessageContent(content: OpenAiMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join('');
}
