import { describe, expect, it } from 'vitest';

import {
  defaultModelId,
  getModelPreset,
  getSupportedModel,
  isSupportedModelId,
  modelPresets,
  supportedModels,
} from './models.js';

describe('shared/models', () => {
  it('returns the configured coding preset', () => {
    expect(getModelPreset('coding')?.modelId).toBe('qwen2.5:7b');
  });

  it('recognizes supported model identifiers', () => {
    expect(isSupportedModelId('llama3.1:8b')).toBe(true);
    expect(isSupportedModelId('unknown-model')).toBe(false);
  });

  it('returns model metadata for configured models', () => {
    expect(getSupportedModel('deepseek-coder-v2:16b')?.family).toBe('DeepSeek');
  });

  it('returns undefined for an unknown model', () => {
    expect(getSupportedModel('nonexistent:1b')).toBeUndefined();
  });

  it('returns undefined for an unknown preset', () => {
    expect(getModelPreset('nonexistent' as 'general')).toBeUndefined();
  });

  it('has unique preset ids', () => {
    const ids = modelPresets.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset references a supported model', () => {
    for (const preset of modelPresets) {
      expect(isSupportedModelId(preset.modelId)).toBe(true);
    }
  });

  it('has unique supported model ids', () => {
    const ids = supportedModels.map((model) => model.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defaultModelId is a supported model', () => {
    expect(isSupportedModelId(defaultModelId)).toBe(true);
  });
});
