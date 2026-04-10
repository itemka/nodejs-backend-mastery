import type {
  ApiErrorPayload,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  CompareRequest,
  CompareResponse,
  HealthResponse,
  LlmCheckerCommandResponse,
  ModelsResponse,
  RecommendationCategory,
} from '../../../shared/api.js';
import { readSseStream } from './sse.js';

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly statusCode: number;

  public constructor(payload: ApiErrorPayload['error']) {
    super(payload.message);

    this.name = 'ApiClientError';
    this.code = payload.code;
    this.details = payload.details;
    this.statusCode = payload.statusCode;
  }
}

export const api = {
  chat(payload: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    return requestJson<ChatResponse>('/api/chat', {
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      ...createSignalInit(signal),
    });
  },

  compare(payload: CompareRequest, signal?: AbortSignal): Promise<CompareResponse> {
    return requestJson<CompareResponse>('/api/compare', {
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      ...createSignalInit(signal),
    });
  },

  async getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    const response = await fetch(resolveApiPath('/api/health'), {
      ...createSignalInit(signal),
    });

    // The health endpoint returns 503 for degraded (API up, Ollama down).
    if (!response.ok && response.status !== 503) {
      throw await toApiError(response);
    }

    return (await response.json()) as HealthResponse;
  },

  getModels(signal?: AbortSignal): Promise<ModelsResponse> {
    return requestJson<ModelsResponse>('/api/models', {
      ...createSignalInit(signal),
    });
  },

  llmChecker: {
    check(signal?: AbortSignal): Promise<LlmCheckerCommandResponse> {
      return requestJson<LlmCheckerCommandResponse>('/api/llm-checker/check', {
        ...createSignalInit(signal),
      });
    },

    installed(signal?: AbortSignal): Promise<LlmCheckerCommandResponse> {
      return requestJson<LlmCheckerCommandResponse>('/api/llm-checker/installed', {
        ...createSignalInit(signal),
      });
    },

    ollamaPlan(signal?: AbortSignal): Promise<LlmCheckerCommandResponse> {
      return requestJson<LlmCheckerCommandResponse>('/api/llm-checker/ollama-plan', {
        ...createSignalInit(signal),
      });
    },

    recommend(
      category: RecommendationCategory,
      signal?: AbortSignal,
    ): Promise<LlmCheckerCommandResponse> {
      const params = new URLSearchParams({
        category,
      });

      return requestJson<LlmCheckerCommandResponse>(
        `/api/llm-checker/recommend?${params.toString()}`,
        {
          ...createSignalInit(signal),
        },
      );
    },
  },

  async streamChat(
    payload: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(resolveApiPath('/api/chat'), {
      body: JSON.stringify({
        ...payload,
        stream: true,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      ...createSignalInit(signal),
    });

    if (!response.ok) {
      throw await toApiError(response);
    }

    await readSseStream(response, (message) => {
      let payload: ChatStreamEvent;

      try {
        payload = JSON.parse(message.data) as ChatStreamEvent;
      } catch {
        onEvent({
          error: {
            code: 'STREAM_PARSE_ERROR',
            message: 'Received malformed stream data.',
            statusCode: 502,
          },
          type: 'error',
        });

        return;
      }

      onEvent(payload);
    });
  },
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiPath(path), init);

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

function resolveApiPath(path: string): string {
  return `${apiBaseUrl}${path}`;
}

async function toApiError(response: Response): Promise<ApiClientError> {
  let payload: ApiErrorPayload | undefined;

  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    payload = undefined;
  }

  if (payload?.error) {
    return new ApiClientError(payload.error);
  }

  return new ApiClientError({
    code: 'HTTP_ERROR',
    message: `Request failed with status ${response.status}.`,
    statusCode: response.status,
  });
}

function createSignalInit(
  signal?: AbortSignal,
): Pick<RequestInit, 'signal'> | Record<string, never> {
  return signal ? { signal } : {};
}
