import type { ConfiguredModelView } from '../../../shared/api.js';
import {
  isSupportedModelId,
  type SupportedModelId,
  supportedModels,
} from '../../../shared/models.js';
import type { OllamaClient } from './ollama-client.js';

export class ModelService {
  public constructor(
    private readonly ollamaClient: OllamaClient,
    private readonly defaultModelId: SupportedModelId,
  ) {}

  public async getConfiguredModels(signal?: AbortSignal): Promise<{
    defaultModel: SupportedModelId;
    installedModelIds: SupportedModelId[];
    models: ConfiguredModelView[];
  }> {
    const rawInstalledModelIds = await this.ollamaClient.getInstalledModelIds(signal);
    const installedModelIds = rawInstalledModelIds.filter((modelId): modelId is SupportedModelId =>
      isSupportedModelId(modelId),
    );
    const installedModelSet = new Set(installedModelIds);

    return {
      defaultModel: this.defaultModelId,
      installedModelIds,
      models: supportedModels.map((model) => ({
        family: model.family,
        id: model.id,
        installed: installedModelSet.has(model.id),
        label: model.label,
        presetTags: [...model.presetTags],
        summary: model.summary,
      })),
    };
  }
}
