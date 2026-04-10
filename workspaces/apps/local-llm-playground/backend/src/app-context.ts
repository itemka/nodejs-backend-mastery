import type { AppEnv } from './config/env.js';
import type { Logger } from './lib/logger.js';
import type { LlmCheckerService } from './services/llm-checker-service.js';
import type { ModelService } from './services/model-service.js';
import type { OllamaClient } from './services/ollama-client.js';

export interface AppContext {
  env: AppEnv;
  llmCheckerService: LlmCheckerService;
  logger: Logger;
  modelService: ModelService;
  ollamaClient: OllamaClient;
}
