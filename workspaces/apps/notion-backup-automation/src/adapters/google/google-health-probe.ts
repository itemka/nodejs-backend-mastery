import { IntegrationError } from '../../application/integration-error.js';
import type { GoogleProbeResult } from '../../application/ports.js';
import { abortable } from '../../shared/abortable.js';
import type { GmailApi } from '../gmail/gmail-api.js';
import { shortScope } from './oauth-client.js';
import type { OAuthTokenProvider } from './token-provider.js';
import { GoogleTokenUnavailableError } from './token-provider.js';

export interface GoogleHealthProbeOptions {
  readonly gmail: Pick<GmailApi, 'getProfile'>;
  readonly tokens: Pick<OAuthTokenProvider, 'grantedScopes'>;
}

/**
 * The Google probe: one token refresh, which must hold both scopes, then Gmail's profile. The
 * mailbox address is read and dropped; only the scopes are reported.
 */
export class GoogleHealthProbe {
  private readonly gmail: Pick<GmailApi, 'getProfile'>;
  private readonly tokens: Pick<OAuthTokenProvider, 'grantedScopes'>;

  constructor({ gmail, tokens }: GoogleHealthProbeOptions) {
    this.gmail = gmail;
    this.tokens = tokens;
  }

  async run(signal?: AbortSignal): Promise<GoogleProbeResult> {
    let scopes: string[];

    try {
      scopes = await abortable(this.tokens.grantedScopes(), signal);
    } catch (error) {
      // A token endpoint outage says nothing about the refresh token itself.
      throw error instanceof GoogleTokenUnavailableError
        ? new IntegrationError('GMAIL_UNAVAILABLE', error.message)
        : error;
    }

    await abortable(this.gmail.getProfile(), signal);

    return { scopes: scopes.map((scope) => shortScope(scope)) };
  }
}
