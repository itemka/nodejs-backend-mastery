import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { createRequestSignal } from './request-signal.js';

class MockTarget extends EventTarget {
  public emit(type: string): boolean {
    return this.dispatchEvent(new Event(type));
  }

  public off(type: string, listener: EventListener): this {
    this.removeEventListener(type, listener);

    return this;
  }

  public on(type: string, listener: EventListener): this {
    this.addEventListener(type, listener);

    return this;
  }
}

class MockRequest extends MockTarget {
  public complete = true;
}

class MockResponse extends MockTarget {
  public writableEnded = false;
}

function toRequest(request: MockRequest): Request {
  return request as unknown as Request;
}

function toResponse(response: MockResponse): Response {
  return response as unknown as Response;
}

describe('backend/lib/request-signal', () => {
  it('aborts when the client disconnects after the request body is complete', () => {
    const request = new MockRequest();
    const response = new MockResponse();
    const signalHandle = createRequestSignal(toRequest(request), toResponse(response), 10_000);

    response.emit('close');

    expect(request.complete).toBe(true);
    expect(signalHandle.signal.aborted).toBe(true);

    signalHandle.cleanup();
  });

  it('does not abort when the response closes after a normal end', () => {
    const request = new MockRequest();
    const response = new MockResponse();
    const signalHandle = createRequestSignal(toRequest(request), toResponse(response), 10_000);

    response.writableEnded = true;
    response.emit('close');

    expect(signalHandle.signal.aborted).toBe(false);

    signalHandle.cleanup();
  });

  it('aborts when the request body is interrupted before completion', () => {
    const request = new MockRequest();
    const response = new MockResponse();
    const signalHandle = createRequestSignal(toRequest(request), toResponse(response), 10_000);

    request.emit('aborted');

    expect(signalHandle.signal.aborted).toBe(true);

    signalHandle.cleanup();
  });
});
