import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL } from '../src/config/env.js';
import { createProvider } from '../src/provider-factory.js';

describe('createProvider', () => {
  it('returns an LlmProvider with createMessage', () => {
    const provider = createProvider({
      anthropicApiKey: 'test-key',
      model: DEFAULT_MODEL,
    });

    expect(typeof provider.createMessage).toBe('function');
  });
});
