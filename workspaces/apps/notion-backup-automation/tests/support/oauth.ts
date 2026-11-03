import type { RefreshTokenGrant } from '../../src/adapters/google/refresh-token-store.js';
import { createWebOAuthClient } from '../../src/adapters/google/web-consent.js';
import { RedisLoginStore } from '../../src/adapters/persistence/google-login-store.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisRateLimiter } from '../../src/adapters/persistence/redis-rate-limiter.js';
import type { GoogleReloginReport } from '../../src/application/google-relogin.js';
import { handleOAuthRequest } from '../../src/http/oauth-handler.js';
import type { OAuthDeps } from '../../src/oauth/deps.js';
import { createLogger } from '../../src/shared/logger.js';
import type { CodeExchange } from './fake-google-identity.js';
import {
  OWNER_EMAIL,
  serveGoogleSignIn,
  WEB_CLIENT_ID,
  WEB_CLIENT_SECRET,
} from './fake-google-identity.js';
import { FakeGoogle } from './fake-google.js';
import { FakeRedis } from './fake-redis.js';
import { ManualClock } from './manual-clock.js';

export const BASE = 'https://nba.example.vercel.app';

export const passingRelogin: GoogleReloginReport = {
  drive: { mode: 'existing', ok: true, probe: 'drive' },
  google: { ok: true, probe: 'google', scopes: ['gmail.readonly', 'drive.file'] },
};

export interface OAuthHarness {
  readonly deps: OAuthDeps;
  readonly google: FakeGoogle;
  readonly logs: string[];
  readonly redis: FakeRedis;
  /** Calls of the re-login's checks and resume. */
  readonly renewals: number[];
  /** Refresh tokens a re-login saved. */
  readonly saved: RefreshTokenGrant[];
  readonly serve: (request: Request) => Promise<Response>;
  /** What the next re-login's checks report. */
  relogin: GoogleReloginReport;
}

/** The phone re-login on fakes: Redis, Google's sign-in, and the checks after a renewal. */
export function oauthHarness(exchange: CodeExchange = {}): OAuthHarness {
  const clock = new ManualClock('2026-11-02T10:00:00Z');
  const redis = new FakeRedis();
  const google = serveGoogleSignIn(new FakeGoogle(), exchange);
  const logs: string[] = [];
  const logger = createLogger({
    sink: (_level, line) => {
      logs.push(line);
    },
  });
  const renewals: number[] = [];
  const saved: RefreshTokenGrant[] = [];
  const deps: OAuthDeps = {
    google: {
      client: () =>
        createWebOAuthClient({
          appBaseUrl: BASE,
          clientId: WEB_CLIENT_ID,
          clientSecret: WEB_CLIENT_SECRET,
          fetch: google.fetch,
          retries: 0,
        }),
      clientId: WEB_CLIENT_ID,
      ownerEmail: OWNER_EMAIL,
    },
    limiter: new RedisRateLimiter(redis, keyPrefixFor('test'), clock),
    logger,
    logins: new RedisLoginStore(redis, keyPrefixFor('test')),
    renewal: {
      relogin: {
        afterRenewal: () => {
          renewals.push(renewals.length + 1);

          return Promise.resolve(harness.relogin);
        },
      },
      tokens: {
        save: (grant) => {
          saved.push(grant);

          return Promise.resolve();
        },
      },
    },
  };
  const harness: OAuthHarness = {
    deps,
    google,
    logs,
    redis,
    relogin: passingRelogin,
    renewals,
    saved,
    serve: (request) => handleOAuthRequest(request, { logger, relogin: () => deps }),
  };

  return harness;
}

export function location(response: Response): URL {
  const value = response.headers.get('location');

  if (value === null) {
    throw new Error(`No redirect: HTTP ${response.status}`);
  }

  return new URL(value);
}

const googleCode = { code: 'google-code' };

/** Google's redirect back with a code, for the sign-in that `googleUrl` started. */
export function googleCallback(
  harness: Pick<OAuthHarness, 'serve'>,
  googleUrl: URL,
  params: Readonly<Record<string, string>> = googleCode,
): Promise<Response> {
  const url = new URL(`${BASE}/oauth/google/callback`);

  url.searchParams.set('state', googleUrl.searchParams.get('state') ?? '');

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  return harness.serve(new Request(url));
}
