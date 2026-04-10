import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

import type { Logger } from '../lib/logger.js';

export function createRequestLogger(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();

    response.locals.requestId = requestId;

    logger.info('request.started', {
      method: request.method,
      path: request.originalUrl,
      requestId,
    });

    response.on('finish', () => {
      logger.info('request.finished', {
        durationMs: Math.round(performance.now() - startedAt),
        method: request.method,
        path: request.originalUrl,
        requestId,
        statusCode: response.statusCode,
      });
    });

    next();
  };
}
