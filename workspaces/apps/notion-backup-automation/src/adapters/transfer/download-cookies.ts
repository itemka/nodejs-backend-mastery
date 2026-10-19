import { z } from 'zod';

import { IntegrationError } from '../../application/integration-error.js';

/** Only Notion's own cookies are ever sent, whatever else the saved session holds. */
const NOTION_COOKIE_DOMAIN = 'notion.com';

/** The cookie fields of Playwright's `storageState()`; other fields are ignored. */
const storageStateSchema = z.object({
  cookies: z.array(
    z.object({
      /** `.notion.com` for a domain cookie, `app.notion.com` for a host-only one. */
      domain: z.string().min(1),
      /** Seconds since the epoch; -1 for a session cookie. */
      expires: z.number(),
      name: z.string().min(1),
      path: z.string(),
      secure: z.boolean(),
      value: z.string(),
    }),
  ),
});

export type SessionCookie = z.infer<typeof storageStateSchema>['cookies'][number];

/** Characters that would end or split a `Cookie` header: separators and control characters. */
const unsafeNameCharacters = /[\s;=,\p{Cc}]/u;
const unsafeValueCharacters = /[;\p{Cc}]/u;

/**
 * The cookies of a saved Notion `storageState` (JSON). An unreadable state is
 * `NOTION_SESSION_EXPIRED`: `auth:notion` writes a new one.
 */
export function parseSessionCookies(storageState: string): SessionCookie[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(storageState);
  } catch {
    throw unreadableSession();
  }

  const result = storageStateSchema.safeParse(parsed);

  if (!result.success) {
    throw unreadableSession();
  }

  return result.data.cookies;
}

/**
 * The `Cookie` header a browser would send to `url` (RFC 6265 domain and path matching), from
 * Notion's unexpired cookies only; undefined when none matches. Longer paths come first.
 */
export function cookieHeaderFor(
  cookies: readonly SessionCookie[],
  url: URL,
  now: Date,
): string | undefined {
  const host = url.hostname.toLowerCase();
  const matching = cookies
    .filter(
      (cookie) =>
        isNotionCookie(cookie) &&
        domainMatches(cookie.domain, host) &&
        pathMatches(cookie.path, url.pathname) &&
        (!cookie.secure || url.protocol === 'https:') &&
        (cookie.expires === -1 || cookie.expires * 1000 > now.getTime()) &&
        !unsafeNameCharacters.test(cookie.name) &&
        !unsafeValueCharacters.test(cookie.value),
    )
    .toSorted((a, b) => b.path.length - a.path.length);

  return matching.length === 0
    ? undefined
    : matching.map(({ name, value }) => `${name}=${value}`).join('; ');
}

function isNotionCookie({ domain }: SessionCookie): boolean {
  const base = domain.toLowerCase().replace(/^\./, '');

  return base === NOTION_COOKIE_DOMAIN || base.endsWith(`.${NOTION_COOKIE_DOMAIN}`);
}

/** A leading dot marks a domain cookie, which also matches subdomains; else the host must equal. */
function domainMatches(domain: string, host: string): boolean {
  const lower = domain.toLowerCase();

  if (!lower.startsWith('.')) {
    return host === lower;
  }

  return host === lower.slice(1) || host.endsWith(lower);
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === '' || cookiePath === '/' || requestPath === cookiePath) {
    return true;
  }

  return (
    requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/')
  );
}

function unreadableSession(): IntegrationError {
  return new IntegrationError('NOTION_SESSION_EXPIRED', 'The saved Notion session is unreadable');
}
