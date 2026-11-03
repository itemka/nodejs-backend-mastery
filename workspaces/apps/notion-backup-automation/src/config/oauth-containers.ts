import { GoogleRefreshTokenStore } from '../adapters/google/refresh-token-store.js';
import { createWebOAuthClient } from '../adapters/google/web-consent.js';
import { RedisLoginStore } from '../adapters/persistence/google-login-store.js';
import { keyPrefixFor } from '../adapters/persistence/keys.js';
import { createRedisClient } from '../adapters/persistence/redis-client.js';
import { RedisJobRepository } from '../adapters/persistence/redis-job-repository.js';
import { RedisNotificationGate } from '../adapters/persistence/redis-notification-gate.js';
import { RedisSecretStore } from '../adapters/persistence/redis-secret-store.js';
import { GoogleRelogin } from '../application/google-relogin.js';
import { JobNotifications } from '../application/job-notifications.js';
import { ProbeRunner } from '../application/probe-runner.js';
import { handleOAuthRequest } from '../http/oauth-handler.js';
import type { OAuthDeps } from '../oauth/deps.js';
import { systemClock } from '../shared/clock.js';
import { createEnvelopeKey } from '../shared/envelope-crypto.js';
import type { ControlDeps } from './control-containers.js';
import { createControlServices, createNotifier, runtimeLogger } from './control-containers.js';
import type { OAuthEnv } from './env.js';
import { googleReauthUrl, loadEnv, oauthEnvSchema } from './env.js';
import { createGoogleServices } from './google-containers.js';

/*
 * The composition root of `/oauth/google/*`, the phone re-login (Phase 13). Like `/mcp`, it must
 * not import the Notion adapters or `containers.ts`, so the function never traces Playwright or
 * serverless Chromium: a re-login runs only the Google and Drive probes.
 */

/** The Google re-login, on Redis, QStash and Google. */
export function createOAuthDeps(env: OAuthEnv, deps: ControlDeps): OAuthDeps {
  const { logger, redis } = deps;
  const clock = deps.clock ?? systemClock;
  const keyPrefix = keyPrefixFor(env.APP_ENV);
  const devFolder = env.APP_ENV === 'dev';
  const fetchOption = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  const control = createControlServices(env, deps);
  const secrets = new RedisSecretStore({
    appEnv: env.APP_ENV,
    clock,
    key: createEnvelopeKey(env.APP_ENCRYPTION_KEY),
    keyPrefix,
    redis,
  });
  const google = createGoogleServices(env, {
    devFolder,
    logger,
    secrets,
    // The probes write no backup, so the sidecar setting never applies here.
    writeSidecar: true,
    ...fetchOption,
    ...(deps.ids === undefined ? {} : { ids: deps.ids }),
  });
  const jobs = new RedisJobRepository(redis, keyPrefix);
  const notifier = createNotifier(env, {
    googleReauthUrl: googleReauthUrl(env),
    logger,
    ...fetchOption,
  });
  const notifications = new JobNotifications({
    clock,
    devFolder,
    gate: new RedisNotificationGate(redis, keyPrefix, clock),
    health: control.health,
    jobs,
    logger,
    notifier,
    policy: control.policy,
  });

  return {
    google: {
      client: () =>
        createWebOAuthClient({
          appBaseUrl: env.APP_BASE_URL,
          clientId: env.GOOGLE_WEB_CLIENT_ID,
          clientSecret: env.GOOGLE_WEB_CLIENT_SECRET,
          ...fetchOption,
        }),
      clientId: env.GOOGLE_WEB_CLIENT_ID,
      ownerEmail: env.OWNER_GOOGLE_EMAIL,
    },
    limiter: control.limiter,
    logger,
    logins: new RedisLoginStore(redis, keyPrefix),
    renewal: {
      relogin: new GoogleRelogin({
        jobs,
        logger,
        notifications,
        probes: new ProbeRunner({
          clock,
          health: control.health,
          logger,
          probes: google.probes,
          timeZone: env.BACKUP_TIME_ZONE,
        }),
        service: control.service,
      }),
      tokens: new GoogleRefreshTokenStore(secrets),
    },
  };
}

/** `/oauth/google/*`: the whole `/oauth` configuration, else 503 `CONFIG_INCOMPLETE`. */
export async function serveOAuth(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ControlDeps> = {},
): Promise<Response> {
  const logger = overrides.logger ?? runtimeLogger(source);

  return handleOAuthRequest(request, {
    logger,
    relogin: () => {
      const env = loadEnv(oauthEnvSchema, source);
      const redis =
        overrides.redis ??
        createRedisClient({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL });

      return createOAuthDeps(env, { ...overrides, logger, redis });
    },
  });
}
