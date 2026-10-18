import type { GoogleService } from '../adapters/google/google-api-client.js';
import { GoogleApiClient } from '../adapters/google/google-api-client.js';
import { OAuthTokenProvider } from '../adapters/google/token-provider.js';
import type { StringCommands } from '../adapters/persistence/redis-secret-store.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';

/** The Redis commands the CLI uses; `@upstash/redis` and test fakes both provide them. */
export interface CliRedis extends StringCommands {
  ping(): Promise<unknown>;
}

/** Everything a command touches outside its own code, so tests can replace it. */
export interface CliContext {
  clock: Clock;
  createRedis: (connection: { token: string; url: string }) => CliRedis;
  /** The variables the commands read: `process.env` after `.env.local` was loaded. */
  env: NodeJS.ProcessEnv;
  /** `.env.local` in the app directory; `auth:google` writes the refresh token here. */
  envFilePath: string;
  /** Replaces `fetch` for every Google call (tests). */
  fetch?: typeof fetch;
  /** Logs go to stderr as JSON lines, separate from the human-facing output. */
  logger: Logger;
  /** Shows the consent URL. It never throws. */
  openBrowser: (url: string) => Promise<void>;
  /** One line of human-facing output. */
  print: (text: string) => void;
}

export interface GoogleCredentialsEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
}

export function fetchOption(context: CliContext): { fetch?: typeof fetch } {
  return context.fetch === undefined ? {} : { fetch: context.fetch };
}

export function createTokenProvider(
  context: CliContext,
  env: GoogleCredentialsEnv,
): OAuthTokenProvider {
  return new OAuthTokenProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
    ...fetchOption(context),
  });
}

export function createGoogleApi(
  context: CliContext,
  service: GoogleService,
  tokenProvider: { getAccessToken(): Promise<string> },
): GoogleApiClient {
  return new GoogleApiClient({ service, tokenProvider, ...fetchOption(context) });
}
