import { ValidationError, normalizeHttpError } from '@workspaces/packages/errors';
import { ZodError } from 'zod';

import type { ApiErrorPayload } from './api.js';

function zodIssuesToFieldErrors(error: ZodError): {
  code: string;
  message: string;
  path: string;
}[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String).join('.'),
  }));
}

function isBodyParserJsonError(error: unknown): error is SyntaxError {
  return (
    error instanceof SyntaxError &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

function normalizeIncomingError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new ValidationError({
      cause: error,
      details: { fieldErrors: zodIssuesToFieldErrors(error) },
      message: 'Request validation failed.',
    });
  }

  if (isBodyParserJsonError(error)) {
    return new ValidationError({
      cause: error,
      code: 'INVALID_JSON',
      details: { fieldErrors: [{ message: 'Request body is not valid JSON.', path: 'body' }] },
      message: 'Request body is not valid JSON.',
    });
  }

  return error;
}

export function toApiErrorPayload(error: unknown): ApiErrorPayload['error'] {
  const normalized = normalizeHttpError(normalizeIncomingError(error));

  return {
    code: normalized.code,
    message: normalized.message,
    statusCode: normalized.statusCode,
    ...(normalized.details === undefined ? {} : { details: normalized.details }),
  };
}
