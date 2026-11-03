import { z } from 'zod';

import { IntegrationError } from '../../application/integration-error.js';
import type { SecretStore } from '../../application/ports.js';
import { EnvelopeError } from '../../shared/envelope-crypto.js';
import { SecretValue } from '../../shared/secret-value.js';
import { parseScopes } from './oauth-client.js';

/**
 * The client a refresh token was issued to: the Desktop client of `auth:google`, or the Web
 * client of the phone re-login. A token refreshes only with its own client.
 */
export const googleTokenClients = ['desktop', 'web'] as const;

export type GoogleTokenClient = (typeof googleTokenClients)[number];

const SECRET_NAME = 'google-refresh-token';

/** The envelope's `meta`: authenticated, not encrypted, so it never holds the token. */
const tokenMetaSchema = z.object({
  client: z.enum(googleTokenClients),
  scopes: z.string().max(512),
});

export interface StoredRefreshToken {
  readonly client: GoogleTokenClient;
  /** When it was stored: the consent that issued it. */
  readonly createdAt: string;
  readonly refreshToken: SecretValue<string>;
  readonly scopes: readonly string[];
}

export interface RefreshTokenGrant {
  readonly client: GoogleTokenClient;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
}

/**
 * The Google refresh token as the `google-refresh-token` envelope of `APP_ENV` (Phase 13), so a
 * re-login replaces it without a redeploy. `GOOGLE_REFRESH_TOKEN` is only the fallback.
 */
export class GoogleRefreshTokenStore {
  private readonly secrets: SecretStore;

  constructor(secrets: SecretStore) {
    this.secrets = secrets;
  }

  /**
   * Undefined when none is stored. An envelope that cannot be opened (another key, tampering)
   * or names no known client is `GOOGLE_AUTH_REQUIRED`: a new consent replaces it.
   */
  async read(): Promise<StoredRefreshToken | undefined> {
    let stored;

    try {
      stored = await this.secrets.get(SECRET_NAME);
    } catch (error) {
      if (error instanceof EnvelopeError) {
        throw new IntegrationError(
          'GOOGLE_AUTH_REQUIRED',
          `The stored Google refresh token cannot be opened (${error.code})`,
        );
      }

      throw error;
    }

    if (stored === undefined) {
      return undefined;
    }

    const meta = tokenMetaSchema.safeParse(stored.meta);

    if (!meta.success || stored.value === '') {
      throw new IntegrationError(
        'GOOGLE_AUTH_REQUIRED',
        'The stored Google refresh token has no known client',
      );
    }

    return {
      client: meta.data.client,
      createdAt: stored.createdAt,
      refreshToken: new SecretValue(stored.value),
      scopes: parseScopes(meta.data.scopes),
    };
  }

  async save({ client, refreshToken, scopes }: RefreshTokenGrant): Promise<void> {
    await this.secrets.put(SECRET_NAME, refreshToken, { client, scopes: scopes.join(' ') });
  }
}
