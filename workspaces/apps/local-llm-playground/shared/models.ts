export const supportedModels = [
  {
    family: 'Qwen',
    id: 'qwen2.5:7b',
    label: 'Qwen 2.5 7B',
    presetTags: ['coding', 'default'],
    summary: 'Balanced default for coding, explanations, and everyday local chat.',
  },
  {
    family: 'Yi',
    id: 'yi:6b',
    label: 'Yi 6B',
    presetTags: ['general'],
    summary: 'Fast and lightweight general-purpose model for quick iterations.',
  },
  {
    family: 'Llama',
    id: 'llama3.1:8b',
    label: 'Llama 3.1 8B',
    presetTags: ['general', 'llama'],
    summary: 'Strong Llama-family baseline for local comparisons.',
  },
  {
    family: 'DeepSeek',
    id: 'deepseek-coder-v2:16b',
    label: 'DeepSeek Coder V2 16B',
    presetTags: ['coding', 'reasoning'],
    summary: 'Heavier local model tuned for coding and deeper reasoning tasks.',
  },
] as const;

export type SupportedModel = (typeof supportedModels)[number];
export type SupportedModelId = SupportedModel['id'];

export const defaultModelId: SupportedModelId = 'qwen2.5:7b';

export const modelPresets = [
  {
    id: 'general',
    label: 'General',
    modelId: 'yi:6b',
  },
  {
    id: 'reasoning',
    label: 'Reasoning',
    modelId: 'deepseek-coder-v2:16b',
  },
  {
    id: 'coding',
    label: 'Coding',
    modelId: 'qwen2.5:7b',
  },
  {
    id: 'llama',
    label: 'Llama',
    modelId: 'llama3.1:8b',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  modelId: SupportedModelId;
}[];

export type ModelPreset = (typeof modelPresets)[number];
export type ModelPresetId = ModelPreset['id'];

export function getModelPreset(presetId: ModelPresetId): ModelPreset | undefined {
  return modelPresets.find((preset) => preset.id === presetId);
}

export function getSupportedModel(modelId: string): SupportedModel | undefined {
  return supportedModels.find((model) => model.id === modelId);
}

export function isSupportedModelId(value: string): value is SupportedModelId {
  return supportedModels.some((model) => model.id === value);
}
