/**
 * Responses of the authenticated functions. Bodies carry codes and statuses only: QStash keeps a
 * failed delivery's body in its DLQ (S3), and nothing a caller sees may hold a URL, a token or
 * content.
 */

/** QStash's "do not retry" status: the message goes to the DLQ at once (S3). */
export const NON_RETRYABLE_STATUS = 489;

export type ResponseHeaders = Readonly<Record<string, string>>;

export function jsonResponse(
  status: number,
  body: unknown,
  headers: ResponseHeaders = {},
): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', ...headers }, status });
}

export function errorResponse(
  status: number,
  code: string,
  headers: ResponseHeaders = {},
): Response {
  return jsonResponse(status, { error: code }, headers);
}

/** 489 with `Upstash-NonRetryable-Error`: a signed message that can never succeed. */
export function nonRetryable(code: string): Response {
  return errorResponse(NON_RETRYABLE_STATUS, code, { 'Upstash-NonRetryable-Error': 'true' });
}

/** 503 with `Retry-After`, which QStash honours before its next attempt (S3). */
export function retryAfter(code: string, seconds: number): Response {
  return errorResponse(503, code, { 'Retry-After': String(Math.max(1, Math.ceil(seconds))) });
}

export function configIncomplete(): Response {
  return errorResponse(503, 'CONFIG_INCOMPLETE');
}

export function unauthorized(code = 'UNAUTHORIZED'): Response {
  return errorResponse(401, code);
}
