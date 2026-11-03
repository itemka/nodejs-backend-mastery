import { GOOGLE_CALLBACK_PATH } from '../adapters/google/web-consent.js';
import { ConfigError, GOOGLE_REAUTH_PATH } from '../config/env.js';
import type { OAuthDeps } from '../oauth/deps.js';
import { handleGoogleCallback, handleGoogleReauth } from '../oauth/google-callback.js';
import { messagePage } from '../oauth/pages.js';
import type { Logger } from '../shared/logger.js';
import { configIncomplete, errorResponse } from './responses.js';

export const oauthActions = ['google-callback', 'google-reauth'] as const;

export type OAuthAction = (typeof oauthActions)[number];

/** The public paths, as `vercel.json` rewrites them to `/api/oauth/<action>`. */
const publicPaths: Readonly<Record<string, OAuthAction>> = {
  [GOOGLE_CALLBACK_PATH]: 'google-callback',
  [GOOGLE_REAUTH_PATH]: 'google-reauth',
};

function isOAuthAction(value: string | null | undefined): value is OAuthAction {
  return (oauthActions as readonly (null | string | undefined)[]).includes(value);
}

/**
 * The action of a request: by its public path, by the function's own path
 * (`/api/oauth/<action>`), or, on that route only, by the segment Vercel adds to the query after
 * a rewrite. No other path reaches an action, so path-based edge rules see every endpoint.
 */
export function oauthActionOf(url: URL): OAuthAction | undefined {
  const byPath = publicPaths[url.pathname];

  if (byPath !== undefined) {
    return byPath;
  }

  const segment = /^\/api\/oauth\/([a-z-]+)$/.exec(url.pathname)?.[1];

  if (isOAuthAction(segment)) {
    return segment;
  }

  if (!url.pathname.startsWith('/api/oauth/')) {
    return undefined;
  }

  const routed = url.searchParams.get('action');

  return isOAuthAction(routed) ? routed : undefined;
}

export interface OAuthHandlerDeps {
  readonly logger: Logger;
  /** Built for each request; throws `ConfigError` while the configuration is incomplete. */
  readonly relogin: () => OAuthDeps;
}

/**
 * `/oauth/google/reauth` and `/oauth/google/callback` (Phase 13): the phone re-login. Both are
 * pages a browser opens, so every failure is a page too. Anyone may start a sign-in; only the
 * owner's Google account, granting both scopes, changes anything.
 */
export async function handleOAuthRequest(
  request: Request,
  deps: OAuthHandlerDeps,
): Promise<Response> {
  const { logger } = deps;
  const action = oauthActionOf(new URL(request.url));

  if (action === undefined) {
    return errorResponse(404, 'NOT_FOUND');
  }

  if (request.method !== 'GET') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', { Allow: 'GET' });
  }

  let relogin: OAuthDeps;

  try {
    relogin = deps.relogin();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('oauth.config_incomplete', { invalid: error.invalid, missing: error.missing });

      return configIncomplete();
    }

    throw error;
  }

  try {
    return await (action === 'google-reauth'
      ? handleGoogleReauth(request, relogin)
      : handleGoogleCallback(request, relogin));
  } catch (error) {
    logger.error('oauth.failed', { action, error });

    return unfinishedPage();
  }
}

/**
 * A step that failed partway. It cannot know which writes landed, so it never claims that
 * nothing changed (review, 2026-11-02).
 */
function unfinishedPage(): Response {
  return messagePage(
    500,
    'Something went wrong',
    'This step did not finish. Open the link again; if it keeps failing, check backup_health.',
  );
}
