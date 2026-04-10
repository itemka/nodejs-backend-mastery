import { Router } from 'express';

import type { CompareResponse, CompareResult } from '../../../shared/api.js';
import { compareRequestSchema } from '../../../shared/api.js';
import type { AppContext } from '../app-context.js';
import { isAbortError, toApiErrorPayload } from '../lib/app-error.js';
import { asyncHandler } from '../lib/async-handler.js';
import { createRequestSignal } from '../lib/request-signal.js';
import { validateWithSchema } from '../lib/validation.js';

export function createCompareRouter(context: AppContext): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const requestId = response.locals.requestId;
      const payload = validateWithSchema(compareRequestSchema, request.body);
      const signalHandle = createRequestSignal(request, response, context.env.REQUEST_TIMEOUT_MS);
      const results: CompareResult[] = [];

      try {
        for (const modelId of payload.modelIds) {
          try {
            const result = await context.ollamaClient.chat(
              {
                maxTokens: payload.maxTokens,
                model: modelId,
                systemPrompt: payload.systemPrompt,
                temperature: payload.temperature,
                userPrompt: payload.userPrompt,
              },
              signalHandle.signal,
            );

            results.push({
              latencyMs: result.latencyMs,
              modelId,
              responseText: result.responseText,
              status: 'success',
            });
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }

            results.push({
              error: toApiErrorPayload(error, requestId),
              latencyMs: 0,
              modelId,
              status: 'error',
            });
          }
        }

        const responsePayload: CompareResponse = {
          hadErrors: results.some((result) => result.status === 'error'),
          requestId,
          results,
        };

        response.json(responsePayload);
      } finally {
        signalHandle.cleanup();
      }
    }),
  );

  return router;
}
