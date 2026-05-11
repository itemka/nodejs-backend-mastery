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

export function toApiErrorPayload(error: unknown): ApiErrorPayload['error'] {
  const normalized = normalizeHttpError(
    error instanceof ZodError
      ? new ValidationError({
          cause: error,
          details: { fieldErrors: zodIssuesToFieldErrors(error) },
          message: 'Request validation failed.',
        })
      : error,
  );

  return {
    code: normalized.code,
    message: normalized.message,
    statusCode: normalized.statusCode,
    ...(normalized.details === undefined ? {} : { details: normalized.details }),
  };
}
