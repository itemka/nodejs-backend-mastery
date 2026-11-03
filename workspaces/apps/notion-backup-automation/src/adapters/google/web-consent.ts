import type { OAuth2Client } from 'google-auth-library';
import { CodeChallengeMethod } from 'google-auth-library';

import type { OAuthClientOptions } from './oauth-client.js';
import {
  createOAuthClient,
  describeOAuthError,
  parseScopes,
  REQUIRED_SCOPES,
} from './oauth-client.js';

/** The Web client's only redirect URI, under `APP_BASE_URL`. */
export const GOOGLE_CALLBACK_PATH = '/oauth/google/callback';

/** The identity to check the owner by, and the scopes of a backup. */
const REAUTH_SCOPES = ['openid', 'email', ...REQUIRED_SCOPES] as const;

export interface WebClientOptions extends Omit<OAuthClientOptions, 'redirectUri'> {
  readonly appBaseUrl: string;
}

/** The Web client "Notion Backup Agent Web", redirecting to `<APP_BASE_URL>/oauth/google/callback`. */
export function createWebOAuthClient({ appBaseUrl, ...options }: WebClientOptions): OAuth2Client {
  return createOAuthClient({ ...options, redirectUri: `${appBaseUrl}${GOOGLE_CALLBACK_PATH}` });
}

/** A failed code exchange. The message never carries the code, the verifier or a token. */
export class WebConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebConsentError';
  }
}

export interface WebConsentStart {
  /** Kept server-side with the state until the callback, never sent to the browser. */
  readonly codeVerifier: string;
  readonly url: string;
}

/**
 * Google's consent URL for a phone re-login: a new refresh token for Gmail and Drive, with the
 * identity to check, under PKCE S256 and the caller's `state`.
 */
export async function startWebConsent(
  client: OAuth2Client,
  state: string,
): Promise<WebConsentStart> {
  const { codeChallenge, codeVerifier } = await client.generateCodeVerifierAsync();

  if (codeChallenge === undefined) {
    throw new Error('PKCE is unavailable: no code challenge was generated');
  }

  const url = client.generateAuthUrl({
    access_type: 'offline',
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    // A re-login must return a refresh token, which Google sends only on a full consent.
    prompt: 'consent',
    scope: [...REAUTH_SCOPES],
    state,
  });

  return { codeVerifier, url };
}

export interface WebConsentTokens {
  /** The signed ID token; `verifyIdToken` checks it before anything trusts it. */
  readonly idToken: string;
  readonly refreshToken?: string;
  readonly scopes: readonly string[];
}

/** Exchanges the callback's code with its PKCE verifier. */
export async function finishWebConsent(
  client: OAuth2Client,
  { code, codeVerifier }: { readonly code: string; readonly codeVerifier: string },
): Promise<WebConsentTokens> {
  let tokens;

  try {
    ({ tokens } = await client.getToken({ code, codeVerifier }));
  } catch (error) {
    // The gaxios error holds the request, client secret and verifier included: never attach it.
    throw new WebConsentError(
      `Google refused the authorization code (${describeOAuthError(error)})`,
    );
  }

  if (typeof tokens.id_token !== 'string' || tokens.id_token === '') {
    throw new WebConsentError('Google returned no ID token');
  }

  return {
    idToken: tokens.id_token,
    scopes: parseScopes(tokens.scope ?? undefined),
    ...(typeof tokens.refresh_token === 'string' && tokens.refresh_token !== ''
      ? { refreshToken: tokens.refresh_token }
      : {}),
  };
}
