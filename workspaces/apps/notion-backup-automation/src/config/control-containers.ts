import type { Redis } from '@upstash/redis';

import { GeminiAgentModel } from '../adapters/llm/gemini-agent-model.js';
import { NoopAgentModel } from '../adapters/llm/noop-agent-model.js';
import { keyPrefixFor } from '../adapters/persistence/keys.js';
import { createRedisClient } from '../adapters/persistence/redis-client.js';
import { RedisHealthStore } from '../adapters/persistence/redis-health-store.js';
import { RedisJobRepository } from '../adapters/persistence/redis-job-repository.js';
import { RedisRateLimiter } from '../adapters/persistence/redis-rate-limiter.js';
import { RedisTelegramState } from '../adapters/persistence/redis-telegram-state.js';
import type { QStashApi } from '../adapters/qstash/qstash-scheduler.js';
import { createQStashClient, QStashScheduler } from '../adapters/qstash/qstash-scheduler.js';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import type { AgentCheckResult } from '../agent/agent-check.js';
import { runAgentCheck } from '../agent/agent-check.js';
import type { AgentModel } from '../agent/agent-model.js';
import type { AgentLimits } from '../agent/limits.js';
import { BackupApplicationService } from '../application/backup-service.js';
import type { HealthStore, RateLimiter } from '../application/ports.js';
import type { BackupPolicy } from '../domain/policy.js';
import { handleMcpRequest } from '../http/mcp-handler.js';
import { configIncomplete } from '../http/responses.js';
import { handleTelegramRequest } from '../http/telegram-handler.js';
import { createMcpServer } from '../mcp/server.js';
import { healthSettingsFrom } from '../mcp/views.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import { randomIds } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { createLogger, logLevels } from '../shared/logger.js';
import { SecretValue } from '../shared/secret-value.js';
import { TelegramWebhook } from '../telegram/webhook.js';
import type { AgentEnv, BackupEnv, McpAuthEnv, McpEnv, WorkerEnv } from './env.js';
import {
  ConfigError,
  healthEnvSchema,
  loadEnv,
  mcpAuthEnvSchema,
  mcpEnvSchema,
  telegramIntegrationId,
  telegramWebhookAuthEnvSchema,
  telegramWebhookEnvSchema,
} from './env.js';

/*
 * The composition root of `/mcp` and the Telegram integration, and the pieces every function
 * shares. Their tools and actions publish wakeups and never run a step, so nothing here builds
 * a browser, a Google client or the encryption key.
 *
 * This module must not import the Notion adapters or `containers.ts`. Vercel traces every
 * import, `import()` included, so one such import puts Playwright and serverless Chromium back
 * into both functions.
 */

export function policyFrom(
  env: Pick<
    BackupEnv,
    | 'EMAIL_WAIT_TIMEOUT_HOURS'
    | 'JOB_MAX_LIFETIME_HOURS'
    | 'MAX_EXPORT_ATTEMPTS'
    | 'MAX_STAGE_RETRIES'
  >,
): BackupPolicy {
  return {
    emailWaitTimeoutHours: env.EMAIL_WAIT_TIMEOUT_HOURS,
    jobMaxLifetimeHours: env.JOB_MAX_LIFETIME_HOURS,
    maxExportAttempts: env.MAX_EXPORT_ATTEMPTS,
    maxStageRetries: env.MAX_STAGE_RETRIES,
  };
}

export type { AgentEnv } from './env.js';

export function agentLimitsFrom(env: AgentEnv): AgentLimits {
  return {
    maxDecisionsPerDay: env.AGENT_MAX_DECISIONS_PER_DAY,
    maxDecisionsPerIncident: env.AGENT_MAX_DECISIONS_PER_INCIDENT,
    maxIncidentsPerJob: env.AGENT_MAX_INCIDENTS_PER_JOB,
    timeoutMs: env.AGENT_TIMEOUT_MS,
  };
}

/** The model `AGENT_MODEL_PROVIDER` names; undefined for `gemini` without `GEMINI_API_KEY`. */
export function createAgentModel(
  env: AgentEnv,
  deps: { readonly fetch?: typeof fetch; readonly logger: Logger },
): AgentModel | undefined {
  if (env.AGENT_MODEL_PROVIDER === 'none') {
    return new NoopAgentModel();
  }

  if (env.GEMINI_API_KEY === undefined) {
    return undefined;
  }

  return new GeminiAgentModel({
    apiKey: new SecretValue(env.GEMINI_API_KEY),
    logger: deps.logger,
    model: env.AGENT_MODEL_NAME,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
}

/** The id `backup_health` reports for the configured model, whether or not it can be built. */
export function agentModelId(
  env: Pick<AgentEnv, 'AGENT_MODEL_NAME' | 'AGENT_MODEL_PROVIDER'>,
): string {
  return env.AGENT_MODEL_PROVIDER === 'none' ? 'none' : `gemini:${env.AGENT_MODEL_NAME}`;
}

/**
 * `checkAgent`'s own limit: `/mcp` may run 30 s (`vercel.json`), and the check must time out,
 * and save that, before the function does. `AGENT_TIMEOUT_MS` (up to 60 s) is the worker's.
 */
export const MAX_AGENT_CHECK_TIMEOUT_MS = 20_000;

export function agentCheckTimeoutMs(env: Pick<AgentEnv, 'AGENT_TIMEOUT_MS'>): number {
  return Math.min(env.AGENT_TIMEOUT_MS, MAX_AGENT_CHECK_TIMEOUT_MS);
}

/** `backup_health({ checkAgent: true })` for the configured model. */
export function agentCheckFor(
  env: AgentEnv,
  deps: { readonly clock: Clock; readonly fetch?: typeof fetch; readonly logger: Logger },
): () => Promise<AgentCheckResult> {
  return () =>
    runAgentCheck(createAgentModel(env, deps), {
      clock: deps.clock,
      modelId: agentModelId(env),
      timeoutMs: agentCheckTimeoutMs(env),
    });
}

/** What the deployed functions take from outside; `RuntimeDeps` adds the browser. */
export interface ControlDeps {
  readonly clock?: Clock;
  /** Replaces `fetch` for Google, the download, Telegram and the heartbeat (tests). */
  readonly fetch?: typeof fetch;
  readonly ids?: IdGenerator;
  readonly logger: Logger;
  /** Replaces the QStash client (tests). */
  readonly qstash?: QStashApi;
  /** The Upstash client: the job repository runs its Lua scripts on it. */
  readonly redis: Redis;
}

/** The deployed functions' QStash scheduler: wakeups to `APP_BASE_URL`, one at a time per `APP_ENV`. */
export function createQStashScheduler(
  env: Pick<WorkerEnv, 'APP_BASE_URL' | 'APP_ENV' | 'QSTASH_TOKEN' | 'QSTASH_URL'>,
  { logger, qstash }: Pick<ControlDeps, 'logger' | 'qstash'>,
): QStashScheduler {
  return new QStashScheduler({
    api: qstash ?? createQStashClient({ baseUrl: env.QSTASH_URL, token: env.QSTASH_TOKEN }),
    appBaseUrl: env.APP_BASE_URL,
    appEnv: env.APP_ENV,
    logger,
  });
}

/** A JSON-line logger at `LOG_LEVEL`, read leniently: a bad value must not stop a function. */
export function runtimeLogger(source: NodeJS.ProcessEnv = process.env): Logger {
  return createLogger({ level: logLevels.find((level) => level === source.LOG_LEVEL) ?? 'info' });
}

/** What `/mcp` and the Telegram webhook need: the job methods, without Google or Notion. */
export type ControlEnv = Pick<
  McpEnv,
  | 'APP_BASE_URL'
  | 'APP_ENV'
  | 'BACKUP_TIME_ZONE'
  | 'EMAIL_WAIT_TIMEOUT_HOURS'
  | 'JOB_MAX_LIFETIME_HOURS'
  | 'MAX_EXPORT_ATTEMPTS'
  | 'MAX_STAGE_RETRIES'
  | 'QSTASH_TOKEN'
  | 'QSTASH_URL'
>;

export interface ControlServices {
  readonly health: HealthStore;
  readonly limiter: RateLimiter;
  readonly policy: BackupPolicy;
  readonly redis: Redis;
  readonly service: BackupApplicationService;
}

/**
 * The application methods on Redis and QStash. They publish wakeups but never run a step, so
 * no browser, Google client or encryption key is built.
 */
export function createControlServices(env: ControlEnv, deps: ControlDeps): ControlServices {
  const { logger, redis } = deps;
  const clock = deps.clock ?? systemClock;
  const keyPrefix = keyPrefixFor(env.APP_ENV);
  const policy = policyFrom(env);

  return {
    health: new RedisHealthStore(redis, keyPrefix),
    limiter: new RedisRateLimiter(redis, keyPrefix, clock),
    policy,
    redis,
    service: new BackupApplicationService({
      clock,
      ids: deps.ids ?? randomIds,
      jobs: new RedisJobRepository(redis, keyPrefix),
      logger,
      policy,
      scheduler: createQStashScheduler(env, deps),
      timeZone: env.BACKUP_TIME_ZONE,
    }),
  };
}

/** The short commit SHA of the deployment, as `/api/health` shows it. */
function deploymentVersion(source: NodeJS.ProcessEnv): string {
  return loadEnv(healthEnvSchema, source).VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
}

/**
 * `POST /mcp`. The bearer token and the `Origin` rule are checked before anything else is
 * configured or run; the tools, built after them, need the whole `/mcp` configuration. Either
 * one incomplete answers 503 `CONFIG_INCOMPLETE`.
 */
export async function serveMcp(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ControlDeps> = {},
): Promise<Response> {
  const logger = overrides.logger ?? runtimeLogger(source);
  let auth: McpAuthEnv;

  try {
    auth = loadEnv(mcpAuthEnvSchema, source);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('mcp.config_incomplete', { invalid: error.invalid, missing: error.missing });

      return configIncomplete();
    }

    throw error;
  }

  return handleMcpRequest(request, {
    allowedOrigins: auth.MCP_ALLOWED_ORIGINS,
    authToken: auth.MCP_AUTH_TOKEN,
    endpoint: () => {
      const env = loadEnv(mcpEnvSchema, source);
      const redis =
        overrides.redis ??
        createRedisClient({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL });
      const control = createControlServices(env, { ...overrides, logger, redis });
      const settings = healthSettingsFrom(env);
      const version = deploymentVersion(source);
      const clock = overrides.clock ?? systemClock;

      return {
        limiter: control.limiter,
        server: () =>
          createMcpServer({
            agentCheck: agentCheckFor(env, {
              clock,
              logger,
              ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
            }),
            clock,
            health: control.health,
            limiter: control.limiter,
            logger,
            service: control.service,
            settings,
            version,
          }),
      };
    },
    logger,
  });
}

/**
 * `POST /api/integrations/telegram`. The integration bearer token is checked before anything else is configured
 * or run; the webhook, built after it, needs the hub, Redis and QStash. Either one
 * incomplete answers 503 `CONFIG_INCOMPLETE`.
 */
export async function serveTelegramIntegration(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ControlDeps> = {},
): Promise<Response> {
  const logger = overrides.logger ?? runtimeLogger(source);
  let webhookSecret: string;

  try {
    ({ TELEGRAM_HUB_TOKEN: webhookSecret } = loadEnv(telegramWebhookAuthEnvSchema, source));
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('telegram.config_incomplete', {
        invalid: error.invalid,
        missing: error.missing,
      });

      return configIncomplete();
    }

    throw error;
  }

  return handleTelegramRequest(request, {
    logger,
    webhook: () => {
      const env = loadEnv(telegramWebhookEnvSchema, source);
      const redis =
        overrides.redis ??
        createRedisClient({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL });
      const control = createControlServices(env, { ...overrides, logger, redis });

      return new TelegramWebhook({
        client: new TelegramClient({
          hubUrl: env.TELEGRAM_HUB_URL,
          integrationId: telegramIntegrationId(env),
          token: new SecretValue(env.TELEGRAM_HUB_TOKEN),
          ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
        }),
        format: { appEnv: env.APP_ENV, timeZone: env.BACKUP_TIME_ZONE },
        ids: overrides.ids ?? randomIds,
        logger,
        policy: control.policy,
        service: control.service,
        state: new RedisTelegramState(
          redis,
          keyPrefixFor(env.APP_ENV),
          overrides.clock ?? systemClock,
        ),
      });
    },
    webhookSecret,
  });
}
