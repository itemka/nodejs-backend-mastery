import type { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * Wrap an Express handler to forward async errors to `next()`.
 *
 * Usage:
 *   router.get('/path', wrapAsync(async (req, res) => { ... }));
 */
export function wrapAsync<
  TRequest extends Request = Request,
  TResponse extends Response = Response,
  TResult = unknown,
>(
  handler: (req: TRequest, res: TResponse, next: NextFunction) => TResult | Promise<TResult>,
): RequestHandler {
  return ((req: TRequest, res: TResponse, next: NextFunction) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  }) as unknown as RequestHandler;
}
