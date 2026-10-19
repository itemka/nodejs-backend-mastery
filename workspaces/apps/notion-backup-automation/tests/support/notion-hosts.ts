import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { onTestFinished } from 'vitest';

export const MAILGUN_HOST = 'mg.mail.notion.com';
export const FILE_HOST = 'file.notion.com';

/** A Mailgun click-tracking link, shaped like the Phase 0 email's. */
export const MAILGUN_LINK = `https://${MAILGUN_HOST}/c/${'t'.repeat(48)}`;

/** Notion's signed export file URL, shaped like Phase 0's hop 2. */
export function fileUrl(expiresAt: Date, overrides: Record<string, string> = {}): string {
  const url = new URL(
    `https://${FILE_HOST}/f/t/00000000-0000-4000-8000-000000000002/Export-00000000-0000-4000-8000-000000000001.zip`,
  );
  const query = {
    download: 'true',
    downloadName: 'Export-00000000-0000-4000-8000-000000000001.zip',
    expirationTimestamp: String(expiresAt.getTime()),
    id: '00000000-0000-4000-8000-000000000002',
    signature: 's'.repeat(43),
    table: 'user_export',
    ...overrides,
  };

  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }

  return url.href;
}

export interface HostRequest {
  readonly cookie: string | undefined;
  readonly headers: IncomingMessage['headers'];
  readonly host: string;
  readonly path: string;
  readonly search: URLSearchParams;
}

type HostHandler = (request: HostRequest, response: ServerResponse) => Promise<void> | void;

/** A handler that answers at once, so tests can compose them. */
type Reply = (request: HostRequest, response: ServerResponse) => void;

/**
 * A local HTTP server standing in for Mailgun and Notion's file host. Its `fetch` sends
 * `https://<host>/<path>` to the server, which dispatches by the original host, so redirects,
 * truncated bodies, stalls and aborts happen on a real socket.
 */
export class NotionHosts {
  readonly requests: HostRequest[] = [];
  private readonly handlers = new Map<string, HostHandler>();
  private port = 0;
  private readonly server: Server;

  private constructor() {
    this.server = createServer((incoming, response) => {
      void this.dispatch(incoming, response);
    });
  }

  /** Starts a server that is closed when the test finishes. */
  static async start(): Promise<NotionHosts> {
    const hosts = new NotionHosts();

    await new Promise<void>((resolve) => {
      hosts.server.listen(0, '127.0.0.1', resolve);
    });
    hosts.port = (hosts.server.address() as AddressInfo).port;
    onTestFinished(() => hosts.close());

    return hosts;
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const local = `http://127.0.0.1:${this.port}/${url.host}${url.pathname}${url.search}`;

    return globalThis.fetch(local, init);
  };

  close(): Promise<void> {
    this.server.closeAllConnections();

    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  on(host: string, handler: HostHandler): this {
    this.handlers.set(host, handler);

    return this;
  }

  requestsTo(host: string): HostRequest[] {
    return this.requests.filter((request) => request.host === host);
  }

  private async dispatch(incoming: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(incoming.url ?? '/', 'http://local');
    const [, host = '', ...rest] = url.pathname.split('/');
    const request: HostRequest = {
      cookie: incoming.headers.cookie,
      headers: incoming.headers,
      host,
      path: `/${rest.join('/')}`,
      search: url.searchParams,
    };

    this.requests.push(request);

    const handler = this.handlers.get(host);

    if (handler === undefined) {
      response.writeHead(599).end(`no handler for ${host}`);

      return;
    }

    await handler(request, response);
  }
}

/** Mailgun's answer to the link: a redirect to `location`. */
export function redirectTo(location: string): Reply {
  return (_request, response) => {
    response.writeHead(302, { Location: location }).end();
  };
}

/** The ZIP as Notion's file host sends it, with its length. */
export function serveBytes(bytes: Uint8Array): Reply {
  return (_request, response) => {
    response
      .writeHead(200, {
        'Content-Length': String(bytes.length),
        'Content-Type': 'application/zip',
      })
      .end(bytes);
  };
}

/** Phase 0's refusal without a session: 403 with an HTML body. */
export const accessDenied: Reply = (_request, response) => {
  response
    .writeHead(403, { 'Content-Type': 'text/html' })
    .end(
      '<html><body>Access denied! Please ask the owner to share the page with you.</body></html>',
    );
};

/** How long the client gets to read what was sent before `onStall` runs. */
const STALL_NOTICE_MS = 50;

/**
 * Sends the first `sentBytes` of `bytes` under the full `Content-Length`, then stays silent.
 * `onStall` runs once the client has read those bytes and waits for more, in the body.
 */
export function stallAfter(bytes: Uint8Array, sentBytes: number, onStall?: () => void): Reply {
  return (_request, response) => {
    response.writeHead(200, { 'Content-Length': String(bytes.length) });
    response.write(bytes.subarray(0, sentBytes), () => {
      setTimeout(() => onStall?.(), STALL_NOTICE_MS);
    });
  };
}

/** Sends the first `sentBytes` of `bytes` under the full `Content-Length`, then drops the socket. */
export function dropAfter(bytes: Uint8Array, sentBytes: number): Reply {
  return (_request, response) => {
    response.writeHead(200, { 'Content-Length': String(bytes.length) });
    response.write(bytes.subarray(0, sentBytes), () => {
      response.socket?.destroy();
    });
  };
}
