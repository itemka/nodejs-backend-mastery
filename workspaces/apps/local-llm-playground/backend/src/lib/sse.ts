import type { Response } from 'express';

export function initializeSse(response: Response): void {
  response.status(200);
  response.setHeader('cache-control', 'no-cache, no-transform');
  response.setHeader('connection', 'keep-alive');
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.flushHeaders();
}

export function sendSseEvent(response: Response, eventName: string, payload: unknown): void {
  if (response.writableEnded) {
    return;
  }

  try {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // Client may have disconnected; ignore write errors on a dead socket.
  }
}
