import { describe, expect, it, vi } from 'vitest';

import type { SupportedModelId } from '../../../shared/models.js';
import { ModelService } from './model-service.js';
import type { OllamaClient } from './ollama-client.js';

describe('backend/services/model-service', () => {
  it('reports the configured env default model in metadata', async () => {
    const ollamaClient = {
      getInstalledModelIds: vi.fn().mockResolvedValue(['yi:6b', 'custom-local-model']),
    } as Pick<OllamaClient, 'getInstalledModelIds'> as OllamaClient;
    const service = new ModelService(ollamaClient, 'yi:6b' satisfies SupportedModelId);

    const result = await service.getConfiguredModels();

    expect(result.defaultModel).toBe('yi:6b');
    expect(result.installedModelIds).toEqual(['yi:6b']);
    expect(result.models.find((model) => model.id === 'yi:6b')?.installed).toBe(true);
    expect(result.models.some((model) => model.id === 'qwen2.5:7b' && model.installed)).toBe(false);
  });
});
