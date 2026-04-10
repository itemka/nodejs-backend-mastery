import { Router, type Request, type Response } from 'express';

import {
  recommendationCategorySchema,
  type LlmCheckerCommandResponse,
} from '../../../shared/api.js';
import type { AppContext } from '../app-context.js';
import { isAbortError } from '../lib/app-error.js';
import { asyncHandler } from '../lib/async-handler.js';
import { createRequestSignal } from '../lib/request-signal.js';
import { validateWithSchema } from '../lib/validation.js';

export function createLlmCheckerRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    '/check',
    asyncHandler(async (request, response) => {
      await runLlmCheckerCommand(request, response, context, (signal) =>
        context.llmCheckerService.runCheck(signal),
      );
    }),
  );

  router.get(
    '/recommend',
    asyncHandler(async (request, response) => {
      const category = validateWithSchema(
        recommendationCategorySchema,
        request.query.category ?? 'general',
      );

      await runLlmCheckerCommand(request, response, context, (signal) =>
        context.llmCheckerService.runRecommend(category, signal),
      );
    }),
  );

  router.get(
    '/installed',
    asyncHandler(async (request, response) => {
      await runLlmCheckerCommand(request, response, context, (signal) =>
        context.llmCheckerService.runInstalled(signal),
      );
    }),
  );

  router.get(
    '/ollama-plan',
    asyncHandler(async (request, response) => {
      await runLlmCheckerCommand(request, response, context, (signal) =>
        context.llmCheckerService.runOllamaPlan(signal),
      );
    }),
  );

  return router;
}

async function runLlmCheckerCommand(
  request: Request,
  response: Response,
  context: AppContext,
  run: (signal: AbortSignal) => Promise<Omit<LlmCheckerCommandResponse, 'requestId'>>,
): Promise<void> {
  const requestId = response.locals.requestId;
  const signalHandle = createRequestSignal(request, response, context.env.REQUEST_TIMEOUT_MS);

  try {
    const result = await run(signalHandle.signal);

    if (signalHandle.signal.aborted || response.writableEnded) {
      return;
    }

    const payload: LlmCheckerCommandResponse = {
      ...result,
      requestId,
    };

    response.json(payload);
  } catch (error) {
    // Client already disconnected — no response needed.
    if (isAbortError(error) && (response.writableEnded || response.socket?.destroyed)) {
      return;
    }

    // Server-side timeout or non-abort error — let the error handler respond.
    throw error;
  } finally {
    signalHandle.cleanup();
  }
}
