import { ZodError } from 'zod';

import type { ApiErrorPayload } from '../../../shared/api.js';

interface AppErrorOptions {
  cause?: unknown;
  code: string;
  details?: unknown;
  message: string;
  statusCode: number;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly statusCode: number;

  public constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = 'AppError';
    this.code = options.code;
    this.details = options.details;
    this.statusCode = options.statusCode;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function toApiErrorPayload(error: unknown, requestId: string): ApiErrorPayload['error'] {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      statusCode: error.statusCode,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      details: error.flatten(),
      message: 'Request validation failed.',
      requestId,
      statusCode: 400,
    };
  }

  if (isAbortError(error)) {
    return {
      code: 'REQUEST_ABORTED',
      message: 'The request was aborted before completion.',
      requestId,
      statusCode: 408,
    };
  }

  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected server error.',
    requestId,
    statusCode: 500,
  };
}
