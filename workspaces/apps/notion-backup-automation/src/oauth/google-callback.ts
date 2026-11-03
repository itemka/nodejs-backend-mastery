import { IdTokenError, isOwner, verifyIdToken } from '../adapters/google/id-token.js';
import { missingScopes, REQUIRED_SCOPES } from '../adapters/google/oauth-client.js';
import type { WebConsentTokens } from '../adapters/google/web-consent.js';
import {
  finishWebConsent,
  startWebConsent,
  WebConsentError,
} from '../adapters/google/web-consent.js';
import type { GoogleReloginReport } from '../application/google-relogin.js';
import { rateLimits } from '../http/rate-limit.js';
import type { OAuthDeps } from './deps.js';
import { randomSecret, redirectTo, single, takeLimit } from './deps.js';
import { messagePage } from './pages.js';
import { stateSchema } from './records.js';

/**
 * `GET /oauth/google/reauth`: the fixed, non-secret link behind Telegram's Fix login and
 * `attention.fixUrl`. It starts a Google consent for Gmail and Drive; nothing is stored until
 * the callback proves the owner's account and both scopes.
 */
export async function handleGoogleReauth(request: Request, deps: OAuthDeps): Promise<Response> {
  const limit = await takeLimit(
    deps,
    request,
    'oauth-reauth',
    rateLimits.oauthReauth,
    rateLimits.oauthReauthTotal,
  );

  if (!limit.allowed) {
    deps.logger.warn('oauth.reauth.rate_limited');

    return messagePage(429, 'Too many sign-ins', 'Wait an hour, then open the link again.');
  }

  const state = randomSecret();
  const consent = await startWebConsent(deps.google.client(), state);

  await deps.logins.save(state, { codeVerifier: consent.codeVerifier });
  deps.logger.info('oauth.reauth.started');

  return redirectTo(consent.url);
}

/**
 * `GET /oauth/google/callback`: the Web client's only redirect. The state must name a sign-in
 * this server started, once. The ID token must verify for the Web client and name
 * `OWNER_GOOGLE_EMAIL`, verified; any other account gets 403. The re-login then needs a refresh
 * token with both scopes.
 */
export async function handleGoogleCallback(request: Request, deps: OAuthDeps): Promise<Response> {
  const { logger } = deps;
  const params = new URL(request.url).searchParams;
  const state = single(params, 'state');
  const login =
    state !== undefined && stateSchema.safeParse(state).success
      ? await deps.logins.take(state)
      : undefined;

  if (login === undefined) {
    logger.warn('oauth.callback.unknown_state');

    return messagePage(
      400,
      'Sign-in expired',
      'This sign-in expired or was already used. Open the link again.',
    );
  }

  const code = single(params, 'code');

  if (single(params, 'error') !== undefined || code === undefined) {
    logger.warn('oauth.callback.not_granted');

    return messagePage(400, 'Not signed in', 'Google did not grant access. Open the link again.');
  }

  const client = deps.google.client();
  let tokens: WebConsentTokens;

  try {
    tokens = await finishWebConsent(client, { code, codeVerifier: login.codeVerifier });

    const identity = await verifyIdToken(client, tokens.idToken, deps.google.clientId);

    if (!isOwner(identity, deps.google.ownerEmail)) {
      logger.warn('oauth.callback.not_owner');

      return messagePage(403, 'Not allowed', 'This Google account may not sign in here.');
    }
  } catch (error) {
    if (error instanceof WebConsentError || error instanceof IdTokenError) {
      logger.warn('oauth.callback.unverified', { error: error.message });

      return messagePage(
        400,
        'Sign-in failed',
        'Google’s answer could not be verified. Start again.',
      );
    }

    throw error;
  }

  return finishReauth(tokens, deps);
}

/** Saves the Web client's refresh token for `APP_ENV`, then checks it and resumes the job. */
async function finishReauth(tokens: WebConsentTokens, deps: OAuthDeps): Promise<Response> {
  const { logger } = deps;
  const missing = missingScopes(tokens.scopes);

  if (missing.length > 0 || tokens.refreshToken === undefined) {
    logger.warn('oauth.reauth.incomplete', {
      missingScopes: missing.length,
      refreshToken: tokens.refreshToken !== undefined,
    });

    return messagePage(
      400,
      'Access not granted',
      'Allow both Gmail and Google Drive, then open the link again. Nothing was changed.',
    );
  }

  await deps.renewal.tokens.save({
    client: 'web',
    refreshToken: tokens.refreshToken,
    scopes: REQUIRED_SCOPES,
  });
  logger.info('oauth.reauth.saved');

  let report: GoogleReloginReport;

  try {
    report = await deps.renewal.relogin.afterRenewal();
  } catch (error) {
    // The token is saved by now: never the generic "did not finish" page.
    logger.error('oauth.reauth.check_failed', { error });

    return messagePage(
      500,
      'Saved, but not checked',
      'The new Google access was saved, but the checks after it did not finish. The daily check runs them again; or open the link again later.',
    );
  }

  if (!report.google.ok) {
    return messagePage(
      502,
      'Saved, but not working yet',
      `The new Google access was saved, but its check failed (${report.google.code}). The daily check tries again; or open the link again later.`,
    );
  }

  return messagePage(
    200,
    'Done',
    `Google access renewed${resumeText(report)}. You can close this page.`,
  );
}

function resumeText({ pendingJobId, resumedJobId }: GoogleReloginReport): string {
  if (resumedJobId !== undefined) {
    return `, and job ${resumedJobId} resumed`;
  }

  return pendingJobId === undefined
    ? ''
    : `. Job ${pendingJobId} was busy, so it was not resumed now; the next daily cron resumes it if it still waits`;
}
