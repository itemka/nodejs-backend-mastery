import type { GoogleService } from '../adapters/google/google-api-client.js';
import { GoogleApiClient } from '../adapters/google/google-api-client.js';
import { OAuthTokenProvider } from '../adapters/google/token-provider.js';
import type { BrowserLauncher } from '../adapters/notion/browser-launcher.js';
import { NotionSessionStore } from '../adapters/notion/notion-session.js';
import { keyPrefixFor } from '../adapters/persistence/keys.js';
import type { HashCommands } from '../adapters/persistence/redis-health-store.js';
import { RedisSecretStore } from '../adapters/persistence/redis-secret-store.js';
import type { JobRepository } from '../application/ports.js';
import type { AppEnv } from '../config/env.js';
import type { Clock } from '../shared/clock.js';
import { createEnvelopeKey } from '../shared/envelope-crypto.js';
import type { Logger } from '../shared/logger.js';

/** The Redis commands the CLI uses; `@upstash/redis` and test fakes both provide them. */
export interface CliRedis extends HashCommands {
  get(key: string): Promise<null | string>;
  ping(): Promise<unknown>;
  /** With `nx`, `OK` when the key was set and null when it existed. */
  set(key: string, value: string, options?: { ex: number; nx: true }): Promise<unknown>;
}

export interface RedisConnection {
  token: string;
  url: string;
}

/** Everything a command touches outside its own code, so tests can replace it. */
export interface CliContext {
  /** Starts the browser for `auth:notion` and `dev:trigger`. */
  browserLauncher: BrowserLauncher;
  clock: Clock;
  /** The job repository of `dev:tick`: Redis, with its Lua scripts; in memory in tests. */
  createJobRepository: (connection: RedisConnection, keyPrefix: string) => JobRepository;
  createRedis: (connection: RedisConnection) => CliRedis;
  /** The variables the commands read: `process.env` after `.env.local` was loaded. */
  env: NodeJS.ProcessEnv;
  /** `.env.local` in the app directory; `auth:google` writes the refresh token here. */
  envFilePath: string;
  /** Replaces `fetch` for every Google and Telegram call (tests). */
  fetch?: typeof fetch;
  /** Logs go to stderr as JSON lines, separate from the human-facing output. */
  logger: Logger;
  /** Shows the consent URL. It never throws. */
  openBrowser: (url: string) => Promise<void>;
  /** One line of human-facing output. */
  print: (text: string) => void;
  /** Where `dev:download` makes its temporary directory; the system's when unset (tests). */
  tempDirectory?: string;
}

export interface GoogleCredentialsEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
}

export interface SecretStoreEnv {
  APP_ENCRYPTION_KEY: string;
  APP_ENV: AppEnv;
  UPSTASH_REDIS_REST_TOKEN: string;
  UPSTASH_REDIS_REST_URL: string;
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

/** The Notion session of `APP_ENV` in Redis, sealed with `APP_ENCRYPTION_KEY`. */
export function createNotionSessions(context: CliContext, env: SecretStoreEnv): NotionSessionStore {
  const redis = context.createRedis({
    token: env.UPSTASH_REDIS_REST_TOKEN,
    url: env.UPSTASH_REDIS_REST_URL,
  });

  return new NotionSessionStore({
    secrets: new RedisSecretStore({
      appEnv: env.APP_ENV,
      clock: context.clock,
      key: createEnvelopeKey(env.APP_ENCRYPTION_KEY),
      keyPrefix: keyPrefixFor(env.APP_ENV),
      redis,
    }),
  });
}
