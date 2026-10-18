import { timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { createServer } from 'node:http';

export type ConsentErrorReason =
  | 'ACCESS_DENIED'
  | 'MISSING_CODE'
  | 'MISSING_REFRESH_TOKEN'
  | 'MISSING_SCOPES'
  | 'STATE_MISMATCH'
  | 'TIMEOUT'
  | 'TOKEN_EXCHANGE_FAILED';

/** A failed local consent. The message names the reason and never carries a code or token. */
export class ConsentError extends Error {
  readonly reason: ConsentErrorReason;

  constructor(reason: ConsentErrorReason, message: string) {
    super(message);
    this.name = 'ConsentError';
    this.reason = reason;
  }
}

export interface LoopbackListenerOptions {
  /** The `state` sent with the consent URL; the redirect must carry the same value. */
  state: string;
  timeoutMs: number;
}

export interface LoopbackListener {
  close(): Promise<void>;
  /** `http://127.0.0.1:<port>`: the redirect URI for this consent only. */
  readonly redirectUri: string;
  /** The redirect's query once `state` matched and a `code` arrived. */
  waitForCallback(): Promise<URLSearchParams>;
}

type Outcome = { error: ConsentError; ok: false } | { ok: true; params: URLSearchParams };

/** OAuth error codes are short snake_case words; anything else is not echoed. */
const oauthErrorPattern = /^[a-z_]{1,64}$/;

/**
 * A one-shot HTTP listener on `127.0.0.1` and a random port for the Desktop client's loopback
 * redirect. The first redirect decides the outcome: a wrong `state` or an `error` fails the
 * consent instead of waiting, and nothing from the query is reflected into the page.
 */
export async function startLoopbackListener({
  state,
  timeoutMs,
}: LoopbackListenerOptions): Promise<LoopbackListener> {
  let outcome: Outcome | undefined;
  let notify: (() => void) | undefined;

  const settle = (next: Outcome) => {
    if (outcome === undefined) {
      outcome = next;
      notify?.();
    }
  };

  const fail = (reason: ConsentErrorReason, message: string) => {
    settle({ error: new ConsentError(reason, message), ok: false });
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method !== 'GET' || url.pathname !== '/') {
      respond(response, 404, 'Not found.');

      return;
    }

    if (outcome !== undefined) {
      respond(response, 409, 'This sign-in has already finished. Return to the terminal.');

      return;
    }

    const params = url.searchParams;
    const error = params.get('error');

    if (error !== null) {
      respond(response, 400, 'Google did not grant access. Return to the terminal.');
      fail(
        'ACCESS_DENIED',
        `Google did not grant access (${oauthErrorPattern.test(error) ? error : 'unknown error'})`,
      );

      return;
    }

    if (!sameState(params.get('state'), state)) {
      respond(response, 400, 'This sign-in could not be verified. Return to the terminal.');
      fail('STATE_MISMATCH', 'The redirect carried a different state; the consent was aborted');

      return;
    }

    if ((params.get('code') ?? '') === '') {
      respond(response, 400, 'Google sent no authorization code. Return to the terminal.');
      fail('MISSING_CODE', 'The redirect carried no authorization code');

      return;
    }

    respond(response, 200, 'Signed in. You can close this tab and return to the terminal.');
    settle({ ok: true, params });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    server.close();

    throw new Error('The loopback listener has no TCP port');
  }

  const timer = setTimeout(() => {
    fail('TIMEOUT', `No redirect arrived within ${Math.round(timeoutMs / 1000)} s`);
  }, timeoutMs);

  return {
    close: async () => {
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
    redirectUri: `http://127.0.0.1:${address.port}`,
    waitForCallback: () =>
      new Promise<URLSearchParams>((resolve, reject) => {
        const deliver = () => {
          if (outcome?.ok === true) {
            resolve(outcome.params);
          } else if (outcome !== undefined) {
            reject(outcome.error);
          }
        };

        if (outcome === undefined) {
          notify = deliver;
        } else {
          deliver();
        }
      }),
  };
}

function sameState(received: null | string, expected: string): boolean {
  if (received === null) {
    return false;
  }

  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

function respond(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Notion Backup Agent</title><p>${text}</p>`,
  );
}
