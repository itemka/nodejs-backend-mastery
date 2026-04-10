import { Router } from 'express';

import type { AppContext } from '../app-context.js';
import { createChatRouter } from './chat-router.js';
import { createCompareRouter } from './compare-router.js';
import { createHealthRouter } from './health-router.js';
import { createLlmCheckerRouter } from './llm-checker-router.js';
import { createModelsRouter } from './models-router.js';

export function createApiRouter(context: AppContext): Router {
  const router = Router();

  router.use('/health', createHealthRouter(context));
  router.use('/models', createModelsRouter(context));
  router.use('/chat', createChatRouter(context));
  router.use('/compare', createCompareRouter(context));
  router.use('/llm-checker', createLlmCheckerRouter(context));

  return router;
}
