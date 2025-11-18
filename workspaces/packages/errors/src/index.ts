export interface HttpErrorOptions<TDetails = unknown> {
  message: string;
  statusCode: number;
  code?: string;
  /**
   * Indicates whether this error is an expected, operational error
   * (e.g. validation, not found) vs a programming/unknown error.
   */
  isOperational?: boolean;
  /**
   * Optional structured details that can be logged or returned by APIs.
   */
  details?: TDetails;
  cause?: unknown;
  stack?: string;
}

export class HttpError<TDetails = unknown> extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details: TDetails | undefined;

  constructor(options: HttpErrorOptions<TDetails>) {
    const { cause, code, details, isOperational = true, message, stack, statusCode } = options;

    super(message, { cause });

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code ?? this.name.toUpperCase();
    this.isOperational = isOperational;
    this.details = details;

    if (stack) {
      this.stack = stack;
    }

    // Set the prototype explicitly when targeting older runtimes;
    // kept for completeness even though Node 22 handles this better.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isHttpError(error: unknown): error is HttpError<unknown> {
  return error instanceof HttpError;
}

export interface NormalizedHttpError<TDetails = unknown> {
  statusCode: number;
  code: string;
  message: string;
  isOperational: boolean;
  details: TDetails | undefined;
  stack: string | undefined;
}

/**
 * Normalize any thrown value into a serializable HTTP error shape
 * that is safe to consume in logging and error handlers.
 */
export function normalizeHttpError(error: unknown): NormalizedHttpError {
  if (isHttpError(error)) {
    return {
      code: error.code,
      details: error.details,
      isOperational: error.isOperational,
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
      isOperational: false,
      message: error.message || 'Unexpected error',
      stack: error.stack ?? undefined,
      statusCode: 500,
    };
  }

  return {
    code: 'INTERNAL_SERVER_ERROR',
    details: error,
    isOperational: false,
    message: 'Unexpected error',
    stack: undefined,
    statusCode: 500,
  };
}

export interface NotFoundErrorOptions
  extends Omit<HttpErrorOptions<{ path?: string }>, 'statusCode'> {
  /**
   * Override the default error code. Defaults to "NOT_FOUND" when omitted.
   */
  code?: string;
}

export class NotFoundError extends HttpError<{ path?: string }> {
  constructor(options: NotFoundErrorOptions) {
    const { code = 'NOT_FOUND', ...rest } = options;

    super({
      code,
      statusCode: 404,
      ...rest,
    });
  }
}

export interface ValidationErrorDetails {
  /**
   * Machine-readable list of validation issues.
   * `path` can be a JSON pointer, dot path, or field name.
   */
  fieldErrors: {
    path: string;
    message: string;
    code?: string;
  }[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ValidationErrorOptions
  extends Omit<HttpErrorOptions<ValidationErrorDetails>, 'statusCode'> {}

/**
 * Represents a client-side input/validation error (HTTP 400).
 *
 * Best practices:
 * - Use for schema/shape/constraint violations.
 * - Keep message user-friendly; put technical detail into `details.fieldErrors`.
 */
export class ValidationError extends HttpError<ValidationErrorDetails> {
  constructor(options: ValidationErrorOptions) {
    const { code = 'VALIDATION_ERROR', ...rest } = options;

    super({
      code,
      statusCode: 400,
      ...rest,
    });
  }
}

export interface UnauthorizedErrorDetails {
  /**
   * Optional internal reason for logging/diagnostics.
   * Avoid exposing sensitive information directly to clients.
   */
  reason?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UnauthorizedErrorOptions
  extends Omit<HttpErrorOptions<UnauthorizedErrorDetails>, 'statusCode'> {}

/**
 * Represents an authentication failure (HTTP 401).
 *
 * Best practices:
 * - Do not leak sensitive reasons to clients; keep the message generic.
 * - Use `details.reason` for internal logging/metrics when needed.
 */
export class UnauthorizedError extends HttpError<UnauthorizedErrorDetails> {
  constructor(options: UnauthorizedErrorOptions) {
    const { code = 'UNAUTHORIZED', message = 'Unauthorized', ...rest } = options;

    super({
      code,
      message,
      statusCode: 401,
      ...rest,
    });
  }
}

export interface ForbiddenErrorDetails {
  /**
   * Optional internal reason for logging/diagnostics.
   * Avoid exposing sensitive information directly to clients.
   */
  reason?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ForbiddenErrorOptions
  extends Omit<HttpErrorOptions<ForbiddenErrorDetails>, 'statusCode'> {}

/**
 * Represents an authorization failure (HTTP 403).
 *
 * Best practices:
 * - Use when the client is authenticated but not allowed to perform an action.
 * - Keep the message generic for clients; use `details.reason` internally if needed.
 */
export class ForbiddenError extends HttpError<ForbiddenErrorDetails> {
  constructor(options: ForbiddenErrorOptions) {
    const { code = 'FORBIDDEN', message = 'Forbidden', ...rest } = options;

    super({
      code,
      message,
      statusCode: 403,
      ...rest,
    });
  }
}

export interface ConflictErrorDetails {
  /**
   * Optional resource identifier or constraint name that caused the conflict.
   */
  resourceId?: string;
  constraint?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConflictErrorOptions
  extends Omit<HttpErrorOptions<ConflictErrorDetails>, 'statusCode'> {}

/**
 * Represents a conflict with the current state of the resource (HTTP 409).
 *
 * Best practices:
 * - Use for version conflicts, duplicate unique keys, etc.
 * - Prefer stable `code` values for clients to branch on.
 */
export class ConflictError extends HttpError<ConflictErrorDetails> {
  constructor(options: ConflictErrorOptions) {
    const { code = 'CONFLICT', message = 'Conflict', ...rest } = options;

    super({
      code,
      message,
      statusCode: 409,
      ...rest,
    });
  }
}

export interface TooManyRequestsErrorDetails {
  /**
   * Optional hint in seconds for when the client may retry.
   */
  retryAfterSeconds?: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TooManyRequestsErrorOptions
  extends Omit<HttpErrorOptions<TooManyRequestsErrorDetails>, 'statusCode'> {}

/**
 * Represents a rate limiting error (HTTP 429).
 *
 * Best practices:
 * - Include `retryAfterSeconds` when you can, and set the `Retry-After` header in HTTP handlers.
 */
export class TooManyRequestsError extends HttpError<TooManyRequestsErrorDetails> {
  constructor(options: TooManyRequestsErrorOptions) {
    const { code = 'TOO_MANY_REQUESTS', message = 'Too many requests', ...rest } = options;

    super({
      code,
      message,
      statusCode: 429,
      ...rest,
    });
  }
}
