import { describe, expect, it } from 'vitest';

import { buildLlmCheckerEnv, isLlmCheckerFailureOutput } from './llm-checker-service.js';

describe('backend/services/llm-checker-service', () => {
  it('overrides llm-checker to use the raw Ollama base url', () => {
    const env = buildLlmCheckerEnv(
      {
        OLLAMA_BASE_URL: 'http://localhost:11434/v1',
        PATH: '/usr/bin',
      },
      'http://localhost:11434',
    );

    expect(env.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.FORCE_COLOR).toBe('0');
  });

  it('treats "Ollama not responding properly" output as failure', () => {
    expect(
      isLlmCheckerFailureOutput(
        'llm-checker | Installed Models\n\nOllama not responding properly\n',
        '- Analyzing installed models...\n✖ Ollama not available\n',
      ),
    ).toBe(true);
  });

  it('does not flag healthy llm-checker output as failure', () => {
    expect(
      isLlmCheckerFailureOutput(
        'INSTALLED MODELS RANKING\nqwen2.5:7b\n',
        '- Analyzing installed models...\n✔ Found 4 installed models\n',
      ),
    ).toBe(false);
  });
});
