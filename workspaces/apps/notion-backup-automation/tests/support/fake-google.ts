/** Fake credentials, built at run time so no token-shaped literal is committed. */
export const fakeCredentials = {
  accessToken: `ya29.${'a'.repeat(24)}-fake`,
  clientId: 'fake-client.apps.googleusercontent.com',
  clientSecret: `fake-${'s'.repeat(20)}`,
  refreshToken: `1//0g${'R'.repeat(32)}xYz4`,
};

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface RecordedRequest {
  /** The body as UTF-8 text. */
  readonly body: string;
  /** The body as sent, for binary uploads. */
  readonly bytes: Uint8Array;
  readonly headers: Headers;
  readonly method: string;
  readonly url: URL;
}

type Handler = (request: RecordedRequest) => Promise<Response> | Response;

interface Route {
  handler: Handler;
  method: string;
  /** `host` + path; `*` matches one path segment. */
  pattern: RegExp;
}

/**
 * An in-process stand-in for Google's HTTP APIs, passed as `fetch`. Routes match the method,
 * host and path; unmatched requests fail the test with a 599 so they are easy to spot.
 */
export class FakeGoogle {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: Route[] = [];

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const recorded: RecordedRequest = {
      // Decoded on demand: most upload bodies are binary and never read as text.
      get body() {
        return new TextDecoder().decode(bytes);
      },
      bytes,
      headers: request.headers,
      method: request.method,
      url: new URL(request.url),
    };

    this.requests.push(recorded);

    const target = `${recorded.url.host}${recorded.url.pathname}`;
    const route = this.routes.find(
      (candidate) => candidate.method === recorded.method && candidate.pattern.test(target),
    );

    return route === undefined
      ? Response.json({ error: `no fake route for ${recorded.method} ${target}` }, { status: 599 })
      : route.handler(recorded);
  };

  /** Registers a route; later registrations of the same route win. */
  on(method: string, hostAndPath: string, handler: Handler): this {
    const pattern = new RegExp(
      `^${hostAndPath.replaceAll(/[.?+^$()[\]{}|\\]/g, String.raw`\$&`).replaceAll('*', '[^/]+')}$`,
    );

    this.routes.unshift({ handler, method, pattern });

    return this;
  }

  /** The token endpoint: code exchange and refresh, with the given grant. */
  onToken(handler: (form: URLSearchParams) => Response): this {
    return this.on('POST', 'oauth2.googleapis.com/token', ({ body }) =>
      handler(new URLSearchParams(body)),
    );
  }

  /** A token endpoint that refreshes successfully with `scope`. */
  onRefresh(scope = `${GMAIL_SCOPE} ${DRIVE_SCOPE}`): this {
    return this.onToken(() =>
      Response.json({
        access_token: fakeCredentials.accessToken,
        expires_in: 3599,
        scope,
        token_type: 'Bearer',
      }),
    );
  }

  requestsTo(hostAndPathPrefix: string): RecordedRequest[] {
    return this.requests.filter((request) =>
      `${request.url.host}${request.url.pathname}`.startsWith(hostAndPathPrefix),
    );
  }
}

/** A Google JSON error body. */
export function googleError(
  status: number,
  reason?: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    {
      error: {
        code: status,
        errors: reason === undefined ? [] : [{ reason }],
        message: 'fake error message that must not be surfaced',
      },
    },
    { headers, status },
  );
}

/** Simulates the browser: follows the consent URL straight to the loopback redirect. */
export function browserThatConsents(
  query: (consentUrl: URL) => Record<string, string> = () => ({}),
): { consentUrls: URL[]; openBrowser: (url: string) => Promise<void> } {
  const consentUrls: URL[] = [];

  return {
    consentUrls,
    openBrowser: async (url) => {
      const consentUrl = new URL(url);

      consentUrls.push(consentUrl);

      const redirect = new URL(consentUrl.searchParams.get('redirect_uri') ?? '');

      for (const [name, value] of Object.entries({
        code: 'fake-authorization-code',
        state: consentUrl.searchParams.get('state') ?? '',
        ...query(consentUrl),
      })) {
        redirect.searchParams.set(name, value);
      }

      await fetch(redirect);
    },
  };
}
