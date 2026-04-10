import { AppError } from '../lib/app-error.js';
import { extractSseEvents, parseOpenAiStreamEvent } from '../lib/openai-sse.js';

interface OllamaHealthPayload {
  version?: string;
}

interface OllamaTagPayload {
  models?: {
    name?: string;
  }[];
}

interface OpenAiChatCompletionPayload {
  choices?: {
    finish_reason?: string;
    message?: {
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
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export interface OllamaChatInput {
  maxTokens?: number | undefined;
  model: string;
  systemPrompt?: string | undefined;
  temperature: number;
  userPrompt: string;
}

export interface OllamaChatResult {
  latencyMs: number;
  model: string;
  responseText: string;
  usage?:
    | {
        completionTokens?: number | undefined;
        promptTokens?: number | undefined;
        totalTokens?: number | undefined;
      }
    | undefined;
}

interface StreamHandlers {
  onDelta(chunk: string): void;
  onDone(result: OllamaChatResult): void;
  onStart(): void;
}

interface StreamState {
  buffer: string;
  model: string;
  responseText: string;
}

interface StreamReader {
  cancel(): Promise<void>;
  read(): Promise<{
    done: boolean;
    value?: Uint8Array;
  }>;
}

export class OllamaClient {
  public constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      rawBaseUrl: string;
    },
  ) {}

  public async chat(input: OllamaChatInput, signal?: AbortSignal): Promise<OllamaChatResult> {
    const startedAt = performance.now();
    const response = await fetch(buildOllamaUrl(this.options.baseUrl, 'chat/completions'), {
      body: JSON.stringify({
        max_tokens: input.maxTokens,
        messages: buildMessages(input),
        model: input.model,
        stream: false,
        temperature: input.temperature,
      }),
      headers: this.buildHeaders(),
      method: 'POST',
      ...createSignalInit(signal),
    });

    if (!response.ok) {
      throw createUpstreamError(response);
    }

    const payload = await readJsonResponse<OpenAiChatCompletionPayload>(response);

    return {
      latencyMs: Math.round(performance.now() - startedAt),
      model:
        typeof payload.model === 'string' && payload.model.trim() ? payload.model : input.model,
      responseText: normalizeMessageContent(payload.choices?.[0]?.message?.content),
      usage: payload.usage
        ? {
            completionTokens: payload.usage.completion_tokens,
            promptTokens: payload.usage.prompt_tokens,
            totalTokens: payload.usage.total_tokens,
          }
        : undefined,
    };
  }

  public async chatStream(
    input: OllamaChatInput,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const startedAt = performance.now();
    const response = await fetch(buildOllamaUrl(this.options.baseUrl, 'chat/completions'), {
      body: JSON.stringify({
        max_tokens: input.maxTokens,
        messages: buildMessages(input),
        model: input.model,
        stream: true,
        temperature: input.temperature,
      }),
      headers: this.buildHeaders(),
      method: 'POST',
      ...createSignalInit(signal),
    });

    if (!response.ok) {
      throw createUpstreamError(response);
    }

    if (!response.body) {
      throw new AppError({
        code: 'OLLAMA_EMPTY_STREAM',
        message: 'Ollama returned an empty stream.',
        statusCode: 502,
      });
    }

    // The route layer uses these callbacks to re-emit Ollama chunks as browser-facing SSE events.
    handlers.onStart();

    const reader = response.body.getReader();
    const state: StreamState = {
      buffer: '',
      model: input.model,
      responseText: '',
    };

    try {
      await readChatStream(reader, handlers, state);

      flushRemainingEvents(handlers, state);
      handlers.onDone(createStreamResult(startedAt, state));
    } catch (error) {
      reader.cancel().catch(() => {
        // Intentionally ignoring cancel errors on a failed stream.
      });
      throw error;
    }
  }

  public async getInstalledModelIds(signal?: AbortSignal): Promise<string[]> {
    const response = await fetch(buildOllamaUrl(this.options.rawBaseUrl, 'api/tags'), {
      headers: this.buildHeaders(),
      ...createSignalInit(signal),
    });

    if (!response.ok) {
      throw createUpstreamError(response);
    }

    const payload = await readJsonResponse<OllamaTagPayload>(response);

    return (payload.models ?? []).flatMap((model) => {
      const name = typeof model.name === 'string' ? model.name.trim() : '';

      return name ? [name] : [];
    });
  }

  public async getVersion(signal?: AbortSignal): Promise<string | undefined> {
    const response = await fetch(buildOllamaUrl(this.options.rawBaseUrl, 'api/version'), {
      headers: this.buildHeaders(),
      ...createSignalInit(signal),
    });

    if (!response.ok) {
      throw createUpstreamError(response);
    }

    const payload = await readJsonResponse<OllamaHealthPayload>(response);

    return payload.version;
  }

  private buildHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.apiKey}`,
      'content-type': 'application/json',
    };
  }
}

async function readChatStream(
  reader: StreamReader,
  handlers: StreamHandlers,
  state: StreamState,
): Promise<void> {
  const decoder = new TextDecoder();

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      flushStreamDecoder(decoder, handlers, state);

      return;
    }

    if (!(chunk.value instanceof Uint8Array)) {
      continue;
    }

    processStreamChunk(chunk.value, decoder, handlers, state);
  }
}

function processStreamChunk(
  chunk: Uint8Array,
  decoder: TextDecoder,
  handlers: StreamHandlers,
  state: StreamState,
): void {
  processDecodedStreamText(decoder.decode(chunk, { stream: true }), handlers, state);
}

function flushStreamDecoder(
  decoder: TextDecoder,
  handlers: StreamHandlers,
  state: StreamState,
): void {
  processDecodedStreamText(decoder.decode(), handlers, state);
}

function processDecodedStreamText(
  decodedText: string,
  handlers: StreamHandlers,
  state: StreamState,
): void {
  if (!decodedText) {
    return;
  }

  state.buffer += decodedText;
  assertStreamBufferWithinLimit(state.buffer);

  const extracted = extractSseEvents(state.buffer);
  state.buffer = extracted.remainder;

  emitParsedEvents(extracted.events, handlers, state, true);
}

function emitParsedEvents(
  events: string[],
  handlers: StreamHandlers,
  state: StreamState,
  captureModel: boolean,
): void {
  for (const event of events) {
    const parsed = parseOpenAiStreamEvent(event);

    if (parsed.done) {
      continue;
    }

    if (captureModel && parsed.model) {
      state.model = parsed.model;
    }

    if (!parsed.deltaText) {
      continue;
    }

    state.responseText += parsed.deltaText;
    handlers.onDelta(parsed.deltaText);
  }
}

function flushRemainingEvents(handlers: StreamHandlers, state: StreamState): void {
  if (!state.buffer.trim()) {
    return;
  }

  const extracted = extractSseEvents(`${state.buffer}\n\n`);
  emitParsedEvents(extracted.events, handlers, state, false);
}

function createStreamResult(startedAt: number, state: StreamState): OllamaChatResult {
  return {
    latencyMs: Math.round(performance.now() - startedAt),
    model: state.model,
    responseText: state.responseText,
  };
}

function assertStreamBufferWithinLimit(buffer: string): void {
  const maxBufferSize = 1024 * 1024;

  if (buffer.length <= maxBufferSize) {
    return;
  }

  throw new AppError({
    code: 'OLLAMA_STREAM_OVERFLOW',
    message: 'The Ollama stream buffer exceeded the maximum allowed size.',
    statusCode: 502,
  });
}

function buildMessages(input: OllamaChatInput): { content: string; role: 'system' | 'user' }[] {
  const messages: { content: string; role: 'system' | 'user' }[] = [];

  if (input.systemPrompt) {
    messages.push({
      content: input.systemPrompt,
      role: 'system',
    });
  }

  messages.push({
    content: input.userPrompt,
    role: 'user',
  });

  return messages;
}

function buildOllamaUrl(baseUrl: string, pathname: string): URL {
  // Preserve base paths like /v1 instead of replacing them with an absolute leading slash.
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return new URL(pathname, normalizedBaseUrl);
}

function createUpstreamError(response: Response): AppError {
  return new AppError({
    code: 'OLLAMA_REQUEST_FAILED',
    details: {
      statusText: response.statusText,
      upstreamStatusCode: response.status,
    },
    message: `Ollama request failed with status ${response.status}.`,
    statusCode: 502,
  });
}

function normalizeMessageContent(
  content:
    | string
    | {
        text?: string;
        type?: string;
      }[]
    | undefined,
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join('');
}

function createSignalInit(
  signal?: AbortSignal,
): Pick<RequestInit, 'signal'> | Record<string, never> {
  return signal ? { signal } : {};
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch (error) {
    throw new AppError({
      cause: error,
      code: 'OLLAMA_INVALID_JSON',
      message: 'Ollama returned an invalid JSON payload.',
      statusCode: 502,
    });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError({
      code: 'OLLAMA_INVALID_JSON',
      message: 'Ollama returned an unexpected JSON shape.',
      statusCode: 502,
    });
  }

  return body as T;
}
