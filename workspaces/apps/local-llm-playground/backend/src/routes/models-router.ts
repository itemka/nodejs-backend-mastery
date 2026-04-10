import { Router } from 'express';

import type { ModelsResponse } from '../../../shared/api.js';
import type { AppContext } from '../app-context.js';
import { asyncHandler } from '../lib/async-handler.js';
import { createRequestSignal } from '../lib/request-signal.js';

export function createModelsRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const requestId = response.locals.requestId;
      const signalHandle = createRequestSignal(request, response, context.env.REQUEST_TIMEOUT_MS);

      try {
        const models = await context.modelService.getConfiguredModels(signalHandle.signal);

        const payload: ModelsResponse = {
          ...models,
          requestId,
        };

        response.json(payload);
      } finally {
        signalHandle.cleanup();
      }
    }),
  );

  return router;
}
