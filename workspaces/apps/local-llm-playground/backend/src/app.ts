import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { AppContext } from './app-context.js';
import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createApiRouter } from './routes/api-router.js';
import { LlmCheckerService } from './services/llm-checker-service.js';
import { ModelService } from './services/model-service.js';
import { OllamaClient } from './services/ollama-client.js';

export function createApp(): {
  app: express.Express;
  context: AppContext;
} {
  const env = loadEnv();
  const app = express();
  const ollamaClient = new OllamaClient({
    apiKey: env.OLLAMA_API_KEY,
    baseUrl: env.OLLAMA_BASE_URL,
    rawBaseUrl: env.OLLAMA_RAW_BASE_URL,
  });
  const modelService = new ModelService(ollamaClient, env.DEFAULT_MODEL);
  const llmCheckerService = new LlmCheckerService(env.REQUEST_TIMEOUT_MS, env.OLLAMA_RAW_BASE_URL);
  const context: AppContext = {
    env,
    llmCheckerService,
    logger,
    modelService,
    ollamaClient,
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(createRequestLogger(logger));
  app.use('/api', createApiRouter(context));

  const clientDistDir = path.resolve(process.cwd(), 'dist/client');
  const clientIndexPath = path.join(clientDistDir, 'index.html');

  if (existsSync(clientIndexPath)) {
    app.use(express.static(clientDistDir));
    app.get(/^(?!\/api).*/, (_request, response) => {
      response.sendFile(clientIndexPath);
    });
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return {
    app,
    context,
  };
}
