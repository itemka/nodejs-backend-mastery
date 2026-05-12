import { describe, expect, it } from 'vitest';

import { DEFAULT_VOYAGE_EMBEDDING_MODEL, loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('parses a valid environment with defaults', () => {
    const env = loadEnv({ VOYAGE_API_KEY: 'sk-test' });

    expect(env).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 4100,
      VOYAGE_API_KEY: 'sk-test',
      VOYAGE_EMBEDDING_MODEL: DEFAULT_VOYAGE_EMBEDDING_MODEL,
    });
  });

  it('rejects missing or empty VOYAGE_API_KEY', () => {
    expect(() => loadEnv({})).toThrow();
    expect(() => loadEnv({ VOYAGE_API_KEY: '   ' })).toThrow();
  });
});
