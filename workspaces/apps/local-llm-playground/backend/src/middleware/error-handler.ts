import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError, toApiErrorPayload } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, request, response, _next) => {
    const requestId = response.locals.requestId ?? 'unknown-request';
    const payload = toApiErrorPayload(error, requestId);

    logger.error('request.failed', {
      code: payload.code,
      message: error instanceof Error ? error.message : String(error),
      method: request.method,
      path: request.originalUrl,
      requestId,
      statusCode: payload.statusCode,
    });

    if (response.headersSent) {
      return;
    }

    response.status(payload.statusCode).json({
      error: payload,
    });
  };
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError({
      code: 'NOT_FOUND',
      message: `No route matches ${request.method} ${request.originalUrl}.`,
      statusCode: 404,
    }),
  );
};
