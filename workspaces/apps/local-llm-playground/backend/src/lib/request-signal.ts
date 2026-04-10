import type { Request, Response } from 'express';

export interface RequestSignalHandle {
  cleanup(): void;
  signal: AbortSignal;
}

export function createRequestSignal(
  request: Request,
  response: Response,
  timeoutMs: number,
): RequestSignalHandle {
  const controller = new AbortController();

  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  // Abort long-running upstream work if the request outlives the configured timeout.
  const timeout = setTimeout(() => {
    abort();
  }, timeoutMs);

  timeout.unref();

  const onAborted = (): void => {
    abort();
  };

  const onClose = (): void => {
    // `response.close` also fires after a normal end, so only treat unfinished responses as disconnects.
    if (!response.writableEnded) {
      abort();
    }
  };

  request.on('aborted', onAborted);
  response.on('close', onClose);

  return {
    cleanup() {
      clearTimeout(timeout);
      request.off('aborted', onAborted);
      response.off('close', onClose);
    },
    signal: controller.signal,
  };
}
