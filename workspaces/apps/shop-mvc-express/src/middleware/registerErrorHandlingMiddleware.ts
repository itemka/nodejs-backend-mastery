import {
  type NormalizedHttpError,
  NotFoundError,
  normalizeHttpError,
} from '@workspaces/packages/errors';
import escapeHtml from 'escape-html';
import { Router, type NextFunction, type Request, type Response } from 'express';

import { env } from '../env';
import { type SafeHtml, renderErrorPage } from '../views/renderErrorPage';
import { renderNotFoundPage } from '../views/renderNotFoundPage';

export function registerErrorHandlingMiddleware() {
  const router = Router();

  // Catch-all 404 for any route that wasn't handled above
  router.use((req, _res, next) => {
    next(
      new NotFoundError({
        details: { path: req.path },
        message: 'The page you are looking for could not be found.',
      }),
    );
  });

  // Centralized error handler
  router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const normalizedError = normalizeHttpError(err);

    // TODO: log via implemented logger later (plus correlationId/requestId when request logging middleware is added)
    // After line 25 (destructuring normalizedError)
    // Future: add correlationId/requestId when request logging middleware is added);
    console.error('Request error normalizedError:', normalizedError);

    const preferredType = getPreferredResponseType(req);
    const isProdEnv = env.NODE_ENV === 'production';
    const isNotFound = normalizedError.statusCode === 404;

    if (preferredType === 'html') {
      if (isNotFound) {
        const html = renderNotFoundPage({ path: req.path });

        return res.status(normalizedError.statusCode).send(html);
      }

      const escapedStack = normalizedError.stack ? escapeHtml(normalizedError.stack) : undefined;

      const detailsHtml: SafeHtml | undefined =
        !isProdEnv && !normalizedError.isOperational && escapedStack
          ? (`<strong>Stack trace</strong>\n\n${escapedStack}` as SafeHtml)
          : undefined;

      const html = renderErrorPage({
        detailsHtml,
        message: getPublicErrorMessage(normalizedError, isProdEnv),
        statusCode: normalizedError.statusCode,
        title: 'Something went wrong',
      });

      return res.status(normalizedError.statusCode).send(html);
    }

    // Fallback to JSON for non-HTML clients (e.g. API clients)
    const jsonBody = buildJsonErrorPayload(normalizedError, isProdEnv);

    return res.status(normalizedError.statusCode).json(jsonBody);
  });

  return router;
}

function getPreferredResponseType(req: Request): 'html' | 'json' {
  const preferredType = req.accepts(['json', 'html']);

  return preferredType === 'html' ? 'html' : 'json';
}

function getPublicErrorMessage(error: NormalizedHttpError, isProdEnv: boolean): string {
  if (isProdEnv && !error.isOperational) {
    return 'An unexpected error occurred.';
  }

  return error.message;
}

function buildJsonErrorPayload(
  error: NormalizedHttpError,
  isProdEnv: boolean,
): {
  error: Record<string, unknown>;
} {
  const message = getPublicErrorMessage(error, isProdEnv);

  const errorBody: Record<string, unknown> = {
    code: error.code,
    message,
  };

  if (error.isOperational && !isProdEnv && error.details !== undefined) {
    errorBody.details = error.details;
  }

  return {
    error: errorBody,
  };
}
