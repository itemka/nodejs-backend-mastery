import { afterEach, describe, expect, it, vi } from 'vitest';

import { OllamaClient } from './ollama-client.js';

describe('backend/services/ollama-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the configured /v1 prefix for chat requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          choices: [
            {
              message: {
                content: 'Hello from Ollama.',
              },
            },
          ],
          model: 'qwen2.5:7b',
        },
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new OllamaClient({
      apiKey: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      rawBaseUrl: 'http://localhost:11434',
    });

    await client.chat({
      model: 'qwen2.5:7b',
      temperature: 0.7,
      userPrompt: 'Say hello.',
    });

    const requestedUrl = fetchMock.mock.calls[0]?.[0];

    expect(requestedUrl).toBeInstanceOf(URL);
    expect((requestedUrl as URL).toString()).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('uses the raw Ollama base url for installed model queries', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          models: [{ name: 'qwen2.5:7b' }],
        },
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new OllamaClient({
      apiKey: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      rawBaseUrl: 'http://localhost:11434',
    });

    await client.getInstalledModelIds();

    const requestedUrl = fetchMock.mock.calls[0]?.[0];

    expect(requestedUrl).toBeInstanceOf(URL);
    expect((requestedUrl as URL).toString()).toBe('http://localhost:11434/api/tags');
  });
});
