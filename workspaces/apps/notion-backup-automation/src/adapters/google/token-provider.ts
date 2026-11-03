import type { OAuth2Client } from 'google-auth-library';

import { IntegrationError } from '../../application/integration-error.js';
import type { GoogleTokenProvider } from '../../application/ports.js';
import type { OAuthClientOptions } from './oauth-client.js';
import {
  createOAuthClient,
  missingScopes,
  oauthErrorOf,
  parseScopes,
  REQUIRED_SCOPES,
  shortScope,
} from './oauth-client.js';
import type { GoogleRefreshTokenStore, GoogleTokenClient } from './refresh-token-store.js';

/** gaxios brands its errors with this symbol; `google-auth-library` does not export the class. */
const gaxiosErrorBrand = Symbol.for('gaxios-gaxios-error');

function isGaxiosError(error: unknown): boolean {
  return error instanceof Error && gaxiosErrorBrand in error;
}

/** OAuth errors that only a new consent can fix: an expired or revoked token, or a bad client. */
const reauthorizationErrors = new Set([
  'invalid_client',
  'invalid_grant',
  'invalid_scope',
  'unauthorized_client',
]);

/**
 * The token endpoint failed transiently (network, 429, 5xx) after gaxios's own retries. The
 * calling API client reports it as its service's `*_UNAVAILABLE` code.
 */
export class GoogleTokenUnavailableError extends Error {
  readonly status: number | undefined;

  constructor(status: number | undefined) {
    super(
      status === undefined
        ? 'The Google token endpoint did not respond'
        : `The Google token endpoint returned HTTP ${status}`,
    );
    this.name = 'GoogleTokenUnavailableError';
    this.status = status;
  }
}

export interface OAuthTokenProviderOptions extends OAuthClientOptions {
  refreshToken: string;
  requiredScopes?: readonly string[];
}

/**
 * Access tokens from `GOOGLE_REFRESH_TOKEN`, cached in memory by the OAuth client until shortly
 * before they expire. Every token it returns holds the required scopes.
 */
export class OAuthTokenProvider implements GoogleTokenProvider {
  // Private: the client holds the refresh token and the client secret.
  readonly #client: OAuth2Client;
  readonly #requiredScopes: readonly string[];

  constructor({
    refreshToken,
    requiredScopes = REQUIRED_SCOPES,
    ...client
  }: OAuthTokenProviderOptions) {
    this.#client = createOAuthClient(client);
    this.#client.setCredentials({ refresh_token: refreshToken });
    this.#requiredScopes = requiredScopes;
  }

  async getAccessToken(): Promise<string> {
    let token: null | string | undefined;

    try {
      ({ token } = await this.#client.getAccessToken());
    } catch (error) {
      throw classifyTokenError(error);
    }

    if (typeof token !== 'string' || token === '') {
      throw new IntegrationError(
        'INTEGRATION_UNCLASSIFIED',
        'The Google token endpoint returned no access token',
      );
    }

    const missing = missingScopes(this.grantedScopesSync(), this.#requiredScopes);

    if (missing.length > 0) {
      throw new IntegrationError(
        'GOOGLE_AUTH_REQUIRED',
        `The refresh token lacks ${missing.map((scope) => shortScope(scope)).join(', ')}`,
      );
    }

    return token;
  }

  /** The scopes of the current access token, refreshing it first if needed. */
  async grantedScopes(): Promise<string[]> {
    await this.getAccessToken();

    return this.grantedScopesSync();
  }

  private grantedScopesSync(): string[] {
    return parseScopes(this.#client.credentials.scope);
  }
}

export interface GoogleClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface StoredTokenProviderOptions {
  /** The Desktop client of `auth:google` and, once created, the Web client of the re-login. */
  readonly clients: Readonly<Partial<Record<GoogleTokenClient, GoogleClientCredentials>>>;
  /** `GOOGLE_REFRESH_TOKEN`, refreshed with the Desktop client while no envelope is stored. */
  readonly fallbackRefreshToken?: string;
  readonly fetch?: typeof fetch;
  readonly requiredScopes?: readonly string[];
  readonly retries?: number;
  /** Unset: `GOOGLE_REFRESH_TOKEN` alone, as the CLI runs without Redis. */
  readonly store?: Pick<GoogleRefreshTokenStore, 'read'>;
}

/** The token a provider refreshes: the stored envelope's, or `GOOGLE_REFRESH_TOKEN`. */
export interface GoogleTokenSource {
  readonly client: GoogleTokenClient;
  readonly stored: boolean;
}

interface ResolvedToken {
  readonly provider: OAuthTokenProvider;
  readonly source: GoogleTokenSource;
}

/**
 * Phase 13's token source: the `google-refresh-token` envelope, written by the phone re-login
 * or `auth:google`, refreshed with the client it names; `GOOGLE_REFRESH_TOKEN` with the Desktop
 * client while none is stored. It is read once per instance, so one invocation uses one token;
 * a failed read is tried again on the next call.
 */
export class StoredTokenProvider implements GoogleTokenProvider {
  readonly #options: StoredTokenProviderOptions;
  #resolved: Promise<ResolvedToken> | undefined;

  constructor(options: StoredTokenProviderOptions) {
    this.#options = options;
  }

  async getAccessToken(): Promise<string> {
    const { provider } = await this.resolved();

    return provider.getAccessToken();
  }

  async grantedScopes(): Promise<string[]> {
    const { provider } = await this.resolved();

    return provider.grantedScopes();
  }

  /** Which token this instance refreshes; `doctor` prints it. */
  async source(): Promise<GoogleTokenSource> {
    const { source } = await this.resolved();

    return source;
  }

  private resolved(): Promise<ResolvedToken> {
    this.#resolved ??= this.resolve().catch((error: unknown) => {
      this.#resolved = undefined;

      throw error;
    });

    return this.#resolved;
  }

  private async resolve(): Promise<ResolvedToken> {
    const { clients, fallbackRefreshToken, store, ...options } = this.#options;
    const stored = await store?.read();
    const client = stored?.client ?? 'desktop';
    const refreshToken = stored?.refreshToken.reveal() ?? fallbackRefreshToken;
    const credentials = clients[client];

    if (refreshToken === undefined) {
      throw new IntegrationError(
        'GOOGLE_AUTH_REQUIRED',
        'No Google refresh token: none is stored for APP_ENV, and GOOGLE_REFRESH_TOKEN is unset',
      );
    }

    if (credentials === undefined) {
      throw new IntegrationError(
        'CONFIG_INCOMPLETE',
        `The stored Google refresh token needs the ${client} OAuth client`,
      );
    }

    return {
      provider: new OAuthTokenProvider({ ...options, ...credentials, refreshToken }),
      source: { client, stored: stored !== undefined },
    };
  }
}

/**
 * Maps a failed refresh to `GOOGLE_AUTH_REQUIRED`, a transient failure, or an unclassified
 * one. The gaxios error is never attached: its config holds the refresh token and secret.
 */
export function classifyTokenError(error: unknown): Error {
  const info = oauthErrorOf(error);

  if (info === undefined) {
    // No response: gaxios reports network failures and timeouts this way. Anything else is a bug.
    return isGaxiosError(error)
      ? new GoogleTokenUnavailableError(undefined)
      : new IntegrationError('UNKNOWN_ERROR', 'The Google token refresh failed unexpectedly');
  }

  if (info.error !== undefined && reauthorizationErrors.has(info.error)) {
    return new IntegrationError(
      'GOOGLE_AUTH_REQUIRED',
      `Google rejected the refresh token (${info.error})`,
    );
  }

  if (info.status === 429 || info.status >= 500) {
    return new GoogleTokenUnavailableError(info.status);
  }

  return new IntegrationError(
    'INTEGRATION_UNCLASSIFIED',
    `The Google token endpoint returned HTTP ${info.status}${info.error === undefined ? '' : ` (${info.error})`}`,
  );
}
