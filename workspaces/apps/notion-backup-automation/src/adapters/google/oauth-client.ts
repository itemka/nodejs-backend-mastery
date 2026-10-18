import type { Credentials } from 'google-auth-library';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { ConsentError, startLoopbackListener } from './loopback-consent.js';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Exactly these two; broadening them needs your approval (S6 fallback 3). */
export const REQUIRED_SCOPES: readonly string[] = [GMAIL_READONLY_SCOPE, DRIVE_FILE_SCOPE];

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/';
const DEFAULT_CONSENT_TIMEOUT_MS = 5 * 60_000;

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  /** Replaces `fetch` for the token endpoint (tests). */
  fetch?: typeof fetch;
  /** gaxios retries of token requests; its default (3, with backoff) when unset. */
  retries?: number;
}

/** The Desktop client "Notion Backup Agent Local Auth". */
export function createOAuthClient({
  clientId,
  clientSecret,
  fetch,
  retries,
}: OAuthClientOptions): OAuth2Client {
  return new OAuth2Client({
    clientId,
    clientSecret,
    transporterOptions: {
      ...(fetch === undefined ? {} : { fetchImplementation: fetch }),
      ...(retries === undefined
        ? {}
        : { retryConfig: { noResponseRetries: retries, retry: retries } }),
    },
  });
}

/** A space-delimited `scope` value as a list. */
export function parseScopes(scope?: string): string[] {
  return (scope ?? '').split(/\s+/).filter((item) => item !== '');
}

export function missingScopes(
  granted: readonly string[],
  required: readonly string[] = REQUIRED_SCOPES,
): string[] {
  return required.filter((scope) => !granted.includes(scope));
}

/** `https://www.googleapis.com/auth/drive.file` → `drive.file`, for output. */
export function shortScope(scope: string): string {
  return scope.startsWith(SCOPE_PREFIX) ? scope.slice(SCOPE_PREFIX.length) : scope;
}

export interface ConsentRequest {
  /** `offline` returns a refresh token; `online` only a short-lived access token. */
  accessType: 'offline' | 'online';
  /** Extra consent URL parameters, such as the Picker's `trigger_onepick`. */
  extraParams?: Readonly<Record<string, string>>;
  scopes: readonly string[];
}

export interface ConsentDependencies {
  /** Shows the consent URL to the user. It must not throw: print the URL if a browser cannot open. */
  openBrowser: (url: string) => Promise<void>;
  timeoutMs?: number;
}

export interface ConsentResult {
  /** The redirect's query: `code`, `state`, `scope`, and `picked_file_ids` from the Picker. */
  callback: URLSearchParams;
  tokens: Credentials;
}

/**
 * One loopback consent: PKCE S256, a random `state`, `prompt=consent`, then the code exchange.
 * Errors never carry the code, the verifier or the token response.
 */
export async function runConsent(
  client: OAuth2Client,
  request: ConsentRequest,
  { openBrowser, timeoutMs = DEFAULT_CONSENT_TIMEOUT_MS }: ConsentDependencies,
): Promise<ConsentResult> {
  const state = randomBytes(32).toString('base64url');
  const { codeChallenge, codeVerifier } = await client.generateCodeVerifierAsync();

  if (codeChallenge === undefined) {
    throw new Error('PKCE is unavailable: no code challenge was generated');
  }

  const listener = await startLoopbackListener({ state, timeoutMs });

  try {
    const url = client.generateAuthUrl({
      ...request.extraParams,
      access_type: request.accessType,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'consent',
      redirect_uri: listener.redirectUri,
      scope: [...request.scopes],
      state,
    });

    await openBrowser(url);

    const callback = await listener.waitForCallback();

    try {
      const { tokens } = await client.getToken({
        code: callback.get('code') ?? '',
        codeVerifier,
        redirect_uri: listener.redirectUri,
      });

      return { callback, tokens };
    } catch (error) {
      // The gaxios error holds the request, client secret and verifier included: never attach it.
      throw new ConsentError(
        'TOKEN_EXCHANGE_FAILED',
        `Google refused the authorization code (${describeOAuthError(error)})`,
      );
    }
  } finally {
    await listener.close();
  }
}

export interface OfflineGrant {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
}

/** The `auth:google` consent: a refresh token that holds both required scopes. */
export async function authorizeOffline(
  client: OAuth2Client,
  dependencies: ConsentDependencies,
): Promise<OfflineGrant> {
  const { tokens } = await runConsent(
    client,
    { accessType: 'offline', scopes: REQUIRED_SCOPES },
    dependencies,
  );
  const scopes = parseScopes(tokens.scope);
  const missing = missingScopes(scopes);

  if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
    throw new ConsentError(
      'MISSING_REFRESH_TOKEN',
      'Google returned no refresh token. Remove the app under Google Account → Security → Third-party access, then run auth:google again',
    );
  }

  if (missing.length > 0) {
    throw new ConsentError(
      'MISSING_SCOPES',
      `Not granted: ${missing.map((scope) => shortScope(scope)).join(', ')}. Run auth:google again and allow every requested permission`,
    );
  }

  if (typeof tokens.access_token !== 'string' || tokens.access_token === '') {
    throw new ConsentError('TOKEN_EXCHANGE_FAILED', 'Google returned no access token');
  }

  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes };
}

const errorResponseSchema = z.object({
  response: z.object({ data: z.unknown(), status: z.number().int() }),
});
const oauthErrorBodySchema = z.object({ error: z.string().regex(/^[a-z_]{1,64}$/) });

export interface OAuthErrorInfo {
  /** The OAuth error code, such as `invalid_grant`, when the body has one. */
  error: string | undefined;
  status: number;
}

/** The OAuth error code and HTTP status of a gaxios error, and nothing else from it. */
export function oauthErrorOf(error: unknown): OAuthErrorInfo | undefined {
  const parsed = errorResponseSchema.safeParse(error);

  if (!parsed.success) {
    return undefined;
  }

  const body = oauthErrorBodySchema.safeParse(parsed.data.response.data);

  return { error: body.success ? body.data.error : undefined, status: parsed.data.response.status };
}

export function describeOAuthError(error: unknown): string {
  const info = oauthErrorOf(error);

  return info === undefined ? 'no response' : (info.error ?? `HTTP ${info.status}`);
}
