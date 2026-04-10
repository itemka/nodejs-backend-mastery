import { Router } from 'express';

import type { ChatResponse, ChatStreamEvent } from '../../../shared/api.js';
import { chatRequestSchema } from '../../../shared/api.js';
import type { AppContext } from '../app-context.js';
import { toApiErrorPayload } from '../lib/app-error.js';
import { asyncHandler } from '../lib/async-handler.js';
import { createRequestSignal } from '../lib/request-signal.js';
import { initializeSse, sendSseEvent } from '../lib/sse.js';
import { validateWithSchema } from '../lib/validation.js';

export function createChatRouter(context: AppContext): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const requestId = response.locals.requestId;
      const payload = validateWithSchema(chatRequestSchema, request.body);
      const chatInput = {
        maxTokens: payload.maxTokens,
        model: payload.model ?? context.env.DEFAULT_MODEL,
        systemPrompt: payload.systemPrompt,
        temperature: payload.temperature,
        userPrompt: payload.userPrompt,
      };
      const signalHandle = createRequestSignal(request, response, context.env.REQUEST_TIMEOUT_MS);

      if (!payload.stream) {
        try {
          const result = await context.ollamaClient.chat(chatInput, signalHandle.signal);

          const responsePayload: ChatResponse = {
            latencyMs: result.latencyMs,
            model: result.model,
            requestId,
            responseText: result.responseText,
            usage: result.usage,
          };

          response.json(responsePayload);
        } finally {
          signalHandle.cleanup();
        }

        return;
      }

      initializeSse(response);

      try {
        await context.ollamaClient.chatStream(
          chatInput,
          {
            onDelta(chunk) {
              const event: ChatStreamEvent = {
                chunk,
                type: 'delta',
              };

              sendSseEvent(response, event.type, event);
            },
            onDone(result) {
              const event: ChatStreamEvent = {
                latencyMs: result.latencyMs,
                model: result.model,
                requestId,
                responseText: result.responseText,
                type: 'done',
              };

              sendSseEvent(response, event.type, event);
            },
            onStart() {
              const event: ChatStreamEvent = {
                requestId,
                type: 'start',
              };

              sendSseEvent(response, event.type, event);
            },
          },
          signalHandle.signal,
        );
      } catch (error) {
        const event: ChatStreamEvent = {
          error: toApiErrorPayload(error, requestId),
          type: 'error',
        };

        sendSseEvent(response, event.type, event);
      } finally {
        signalHandle.cleanup();

        if (!response.writableEnded) {
          try {
            response.end();
          } catch {
            // Ignore errors if client already disconnected.
          }
        }
      }
    }),
  );

  return router;
}
