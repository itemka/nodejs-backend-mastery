import { Router } from 'express';

import type { HealthResponse } from '../../../shared/api.js';
import type { AppContext } from '../app-context.js';
import { asyncHandler } from '../lib/async-handler.js';
import { createRequestSignal } from '../lib/request-signal.js';

export function createHealthRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const requestId = response.locals.requestId;
      const signalHandle = createRequestSignal(request, response, context.env.REQUEST_TIMEOUT_MS);

      let installedModelCount = 0;
      let ollamaAvailable = false;
      let ollamaVersion: string | undefined;

      try {
        const [version, configuredModels] = await Promise.all([
          context.ollamaClient.getVersion(signalHandle.signal),
          context.modelService.getConfiguredModels(signalHandle.signal),
        ]);

        ollamaAvailable = true;
        ollamaVersion = version;
        installedModelCount = configuredModels.installedModelIds.length;
      } catch (error) {
        context.logger.warn('health.ollama_unavailable', {
          error: error instanceof Error ? error.message : String(error),
          requestId,
        });
      } finally {
        signalHandle.cleanup();
      }

      const payload: HealthResponse = {
        defaultModel: context.env.DEFAULT_MODEL,
        installedModelCount,
        ollamaAvailable,
        ollamaVersion,
        requestId,
        status: ollamaAvailable ? 'ok' : 'degraded',
      };

      const statusCode = ollamaAvailable ? 200 : 503;

      response.status(statusCode).json(payload);
    }),
  );

  return router;
}
