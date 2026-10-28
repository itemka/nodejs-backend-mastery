import { isBearer } from './cron-auth.js';

/** `/mcp`: `Authorization: Bearer $MCP_AUTH_TOKEN`, compared in constant time. */
export function isMcpRequest(request: Request, authToken: string): boolean {
  return isBearer(request.headers.get('authorization'), authToken);
}

/**
 * The `Origin` rule: a request without one (a CLI or desktop MCP client) passes, while a
 * browser's must be listed in `MCP_ALLOWED_ORIGINS`, which is empty by default. A page on another
 * site therefore cannot use a token that leaked into the browser.
 */
export function isAllowedOrigin(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get('origin');

  return origin === null || allowedOrigins.includes(origin);
}
