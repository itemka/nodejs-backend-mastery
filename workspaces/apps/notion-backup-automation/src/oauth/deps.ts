import type { OAuth2Client } from 'google-auth-library';
import { createHash, randomBytes } from 'node:crypto';

import type { GoogleRefreshTokenStore } from '../adapters/google/refresh-token-store.js';
import type { RedisLoginStore } from '../adapters/persistence/google-login-store.js';
import type { GoogleRelogin } from '../application/google-relogin.js';
import type { RateLimit, RateLimiter, RateLimitResult } from '../application/ports.js';
import type { Logger } from '../shared/logger.js';

/** The Web client's sign-in, and the one account it accepts. */
export interface GoogleSignIn {
  /** A new Web OAuth client per use, redirecting to `/oauth/google/callback`. */
  readonly client: () => OAuth2Client;
  /** `GOOGLE_WEB_CLIENT_ID`: the audience every ID token must name. */
  readonly clientId: string;
  /** `OWNER_GOOGLE_EMAIL`. Never logged or shown. */
  readonly ownerEmail: string;
}

/** What a phone re-login saves, then checks and resumes. */
export interface GoogleRenewal {
  readonly relogin: Pick<GoogleRelogin, 'afterRenewal'>;
  readonly tokens: Pick<GoogleRefreshTokenStore, 'save'>;
}

/** Everything the phone re-login runs on (Phase 13). */
export interface OAuthDeps {
  readonly google: GoogleSignIn;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  /** The Google sign-ins in flight, each taken once by the callback. */
  readonly logins: Pick<RedisLoginStore, 'save' | 'take'>;
  readonly renewal: GoogleRenewal;
}

/**
 * The caller's IP as Vercel reports it (`x-real-ip`, else the first `x-forwarded-for`; Vercel
 * sets both itself), hashed so no address is kept in a Redis key.
 */
export function callerKey(request: Request): string {
  const ip =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0];
  const trimmed = ip?.trim() ?? '';

  return trimmed === ''
    ? 'unknown'
    : createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
}

/**
 * One budget per caller IP, then, when `total` is given, the ceiling for every caller together.
 * Unauthenticated requests therefore cannot use up the owner's budget (security review,
 * 2026-11-02).
 */
export async function takeLimit(
  deps: Pick<OAuthDeps, 'limiter'>,
  request: Request,
  name: string,
  perCaller: RateLimit,
  total?: RateLimit,
): Promise<RateLimitResult> {
  const own = await deps.limiter.take(`${name}:${callerKey(request)}`, perCaller);

  return !own.allowed || total === undefined ? own : deps.limiter.take(name, total);
}

/** 256 random bits, base64url: a sign-in state. */
export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** A 302 that no cache keeps and that leaks no referrer. */
export function redirectTo(location: string): Response {
  return new Response(undefined, {
    headers: {
      'Cache-Control': 'no-store',
      Location: location,
      'Referrer-Policy': 'no-referrer',
    },
    status: 302,
  });
}

/** One parameter that appears exactly once; a repeated one is refused (RFC 6749 3.1). */
export function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);

  return values.length === 1 && values[0] !== '' ? values[0] : undefined;
}
