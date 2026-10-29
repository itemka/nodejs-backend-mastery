import { DriveBackupStorage } from '../adapters/drive/drive-backup-storage.js';
import { DriveHealthProbe } from '../adapters/drive/drive-health-probe.js';
import { ResumableUploader } from '../adapters/drive/resumable-upload.js';
import { GmailApi } from '../adapters/gmail/gmail-api.js';
import { GmailExportEmailFinder } from '../adapters/gmail/gmail-export-email-finder.js';
import { GoogleApiClient } from '../adapters/google/google-api-client.js';
import { GoogleHealthProbe } from '../adapters/google/google-health-probe.js';
import { OAuthTokenProvider } from '../adapters/google/token-provider.js';
import { HttpHeartbeat, NoopHeartbeat } from '../adapters/heartbeat/http-heartbeat.js';
import { NoopAgentModel } from '../adapters/llm/noop-agent-model.js';
import type { NamedNotifier } from '../adapters/notifications/composite-notifier.js';
import { CompositeNotifier } from '../adapters/notifications/composite-notifier.js';
import { ConsoleNotifier } from '../adapters/notifications/console-notifier.js';
import { TelegramNotifier } from '../adapters/notifications/telegram-notifier.js';
import type { BrowserLauncher } from '../adapters/notion/browser-launcher.js';
import { createBrowserLauncher } from '../adapters/notion/browser-launcher.js';
import { PlaywrightNotionExportTrigger } from '../adapters/notion/notion-export-trigger.js';
import { NotionSessionStore } from '../adapters/notion/notion-session.js';
import { keyPrefixFor } from '../adapters/persistence/keys.js';
import { createRedisClient } from '../adapters/persistence/redis-client.js';
import type { HashCommands } from '../adapters/persistence/redis-health-store.js';
import { RedisHealthStore } from '../adapters/persistence/redis-health-store.js';
import { RedisJobRepository } from '../adapters/persistence/redis-job-repository.js';
import type { SetIfAbsentCommands } from '../adapters/persistence/redis-notification-gate.js';
import { RedisNotificationGate } from '../adapters/persistence/redis-notification-gate.js';
import type { CounterCommands } from '../adapters/persistence/redis-rate-limiter.js';
import { RedisRateLimiter } from '../adapters/persistence/redis-rate-limiter.js';
import type { StringCommands } from '../adapters/persistence/redis-secret-store.js';
import { RedisSecretStore } from '../adapters/persistence/redis-secret-store.js';
import { QStashSignatureVerifier } from '../adapters/qstash/qstash-signature-verifier.js';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import { TmpExportTransfer } from '../adapters/transfer/export-transfer.js';
import { HttpDownloader } from '../adapters/transfer/http-downloader.js';
import type { AgentModel } from '../agent/agent-model.js';
import type { AgentLimits } from '../agent/limits.js';
import { defaultAgentLimits } from '../agent/limits.js';
import { Supervisor } from '../agent/supervisor.js';
import { BackupApplicationService } from '../application/backup-service.js';
import { DailyMaintenance } from '../application/daily-maintenance.js';
import { JobNotifications } from '../application/job-notifications.js';
import { LoginWarnings } from '../application/login-watch.js';
import type {
  HealthProbes,
  HealthStore,
  JobRepository,
  NotificationGate,
  Notifier,
  NotionLoginInfo,
  Scheduler,
} from '../application/ports.js';
import { ProcessJobUseCase } from '../application/process-job.js';
import { handleCronRequest } from '../http/cron-handler.js';
import { configIncomplete } from '../http/responses.js';
import { handleWorkerRequest } from '../http/worker-handler.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { createEnvelopeKey } from '../shared/envelope-crypto.js';
import type { IdGenerator } from '../shared/ids.js';
import { randomIds } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { SecretValue } from '../shared/secret-value.js';
import type { ControlDeps } from './control-containers.js';
import {
  agentLimitsFrom,
  createAgentModel,
  createQStashScheduler,
  policyFrom,
  runtimeLogger,
} from './control-containers.js';
import type { BackupEnv, CronEnv, WorkerAuthEnv, WorkerEnv } from './env.js';
import {
  ConfigError,
  cronAuthEnvSchema,
  cronEnvSchema,
  loadEnv,
  telegramIntegrationId,
  workerAuthEnvSchema,
  workerEnvSchema,
} from './env.js';

export type { AgentEnv, ControlDeps, ControlEnv, ControlServices } from './control-containers.js';
export {
  agentLimitsFrom,
  createAgentModel,
  createControlServices,
  createQStashScheduler,
  policyFrom,
  runtimeLogger,
  serveMcp,
  serveTelegramIntegration,
} from './control-containers.js';

/*
 * The composition root of the worker, the cron and the CLI: the backup services, the browser
 * among them. `/mcp` and the Telegram integration build only the control services, from
 * `control-containers.ts`, whose exports this module repeats. Their entries import that module
 * directly, so their functions never trace Playwright or serverless Chromium.
 */

export type NotifierEnv = Pick<
  BackupEnv,
  | 'APP_ENV'
  | 'BACKUP_TIME_ZONE'
  | 'NOTIFIERS'
  | 'TELEGRAM_HUB_TOKEN'
  | 'TELEGRAM_HUB_URL'
  | 'TELEGRAM_INTEGRATION_ID'
>;

/**
 * The notifiers `NOTIFIERS` lists, behind one `CompositeNotifier`. Telegram listed without its
 * two variables is left out with a warning: the app then notifies through the console only.
 */
export function createNotifier(
  env: NotifierEnv,
  { fetch: fetchImpl, logger }: { fetch?: typeof globalThis.fetch; logger: Logger },
): Notifier {
  const notifiers: NamedNotifier[] = [];

  if (env.NOTIFIERS.includes('console')) {
    notifiers.push({ name: 'console', notifier: new ConsoleNotifier(logger) });
  }

  if (env.NOTIFIERS.includes('telegram')) {
    const { TELEGRAM_HUB_TOKEN: token, TELEGRAM_HUB_URL: hubUrl } = env;

    if (token === undefined || hubUrl === undefined) {
      logger.warn('notify.telegram.unconfigured', {
        missing: [
          ...(token === undefined ? ['TELEGRAM_HUB_TOKEN'] : []),
          ...(hubUrl === undefined ? ['TELEGRAM_HUB_URL'] : []),
        ],
      });
    } else {
      notifiers.push({
        name: 'telegram',
        notifier: new TelegramNotifier({
          appEnv: env.APP_ENV,
          client: new TelegramClient({
            hubUrl,
            integrationId: telegramIntegrationId(env),
            token: new SecretValue(token),
            ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
          }),
          timeZone: env.BACKUP_TIME_ZONE,
        }),
      });
    }
  }

  return new CompositeNotifier(notifiers, logger);
}

/** The Redis commands the stores use besides the job repository's scripts. */
export type StoreRedis = CounterCommands & HashCommands & SetIfAbsentCommands & StringCommands;

/** The supervisor's model and budgets; without them, `NoopAgentModel` with the default budgets. */
export interface AgentDeps {
  readonly limits: AgentLimits;
  readonly model: AgentModel;
}

export interface BackupServicesDeps {
  readonly agent?: AgentDeps;
  readonly browserLauncher: BrowserLauncher;
  readonly clock?: Clock;
  /** Replaces `fetch` for Google, the download and Telegram (tests). */
  readonly fetch?: typeof fetch;
  readonly ids?: IdGenerator;
  /** `RedisJobRepository` on the same database, or the in-memory one. */
  readonly jobs: JobRepository;
  readonly logger: Logger;
  readonly redis: StoreRedis;
  /** QStash in the worker; `dev:tick` publishes nothing. */
  readonly scheduler: Scheduler;
}

export interface BackupServices {
  /** Marks notifications and login warnings as sent. */
  readonly gate: NotificationGate;
  readonly health: HealthStore;
  readonly jobs: JobRepository;
  readonly notifications: JobNotifications;
  /** The saved Notion session's recorded expiry. */
  readonly notionLogin: NotionLoginInfo;
  /** The cron's dependency checks, on the same adapters the backup uses. */
  readonly probes: HealthProbes;
  readonly processJob: ProcessJobUseCase;
  readonly service: BackupApplicationService;
}

/** The tick and the application methods, with every adapter they use, for `APP_ENV`. */
export function createBackupServices(env: BackupEnv, deps: BackupServicesDeps): BackupServices {
  const { browserLauncher, jobs, logger, redis, scheduler } = deps;
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? randomIds;
  const fetchOption = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  const keyPrefix = keyPrefixFor(env.APP_ENV);
  const devFolder = env.APP_ENV === 'dev';
  const policy = policyFrom(env);
  const secrets = new RedisSecretStore({
    appEnv: env.APP_ENV,
    clock,
    key: createEnvelopeKey(env.APP_ENCRYPTION_KEY),
    keyPrefix,
    redis,
  });
  const tokenProvider = new OAuthTokenProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
    ...fetchOption,
  });
  const gmail = new GmailApi(
    new GoogleApiClient({ service: 'gmail', tokenProvider, ...fetchOption }),
  );
  const driveApi = new GoogleApiClient({ service: 'drive', tokenProvider, ...fetchOption });
  const driveStorage = (dev: boolean) =>
    new DriveBackupStorage({
      api: driveApi,
      devFolder: dev,
      logger,
      rootFolderId: env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID,
      uploader: new ResumableUploader({ tokenProvider, ...fetchOption }),
      writeSidecar: env.WRITE_SHA256_SIDECAR,
    });
  const storage = driveStorage(devFolder);
  const emails = new GmailExportEmailFinder({ gmail, logger });
  const gate = new RedisNotificationGate(redis, keyPrefix, clock);
  const health = new RedisHealthStore(redis, keyPrefix);
  const sessions = new NotionSessionStore({ secrets });
  const trigger = new PlaywrightNotionExportTrigger({
    clock,
    exportFormat: env.NOTION_EXPORT_FORMAT,
    launcher: browserLauncher,
    logger,
    sessions,
    workspace: { name: env.NOTION_WORKSPACE_NAME, url: env.NOTION_WORKSPACE_URL },
  });
  const notifications = new JobNotifications({
    clock,
    devFolder,
    gate,
    health,
    jobs,
    logger,
    notifier: createNotifier(env, { logger, ...fetchOption }),
    policy,
  });
  const supervisor = new Supervisor({
    clock,
    limiter: new RedisRateLimiter(redis, keyPrefix, clock),
    limits: deps.agent?.limits ?? defaultAgentLimits,
    logger,
    model: deps.agent?.model ?? new NoopAgentModel(),
    policy,
    workspaceName: env.NOTION_WORKSPACE_NAME,
  });
  const processJob = new ProcessJobUseCase({
    clock,
    emails,
    exportShrinkRatio: env.EXPORT_SHRINK_RATIO,
    health,
    ids,
    jobs,
    logger,
    notifications,
    policy,
    scheduler,
    storage,
    supervisor,
    timeZone: env.BACKUP_TIME_ZONE,
    transfer: new TmpExportTransfer({
      clock,
      downloader: new HttpDownloader({ clock, logger, ...fetchOption }),
      emailFinder: emails,
      logger,
      secrets,
      storage,
    }),
    trigger,
  });
  const service = new BackupApplicationService({
    clock,
    ids,
    jobs,
    logger,
    policy,
    scheduler,
    timeZone: env.BACKUP_TIME_ZONE,
  });

  const googleProbe = new GoogleHealthProbe({ gmail, tokens: tokenProvider });
  const driveProbe = new DriveHealthProbe({
    api: driveApi,
    devStorage: devFolder ? storage : driveStorage(true),
    ids,
    logger,
    storage,
  });
  const probes: HealthProbes = {
    drive: (period, signal) => driveProbe.run(period, signal),
    google: (signal) => googleProbe.run(signal),
    notion: (signal) => trigger.probeExportDialog(signal),
  };

  return {
    gate,
    health,
    jobs,
    notifications,
    notionLogin: sessions,
    probes,
    processJob,
    service,
  };
}

export interface RuntimeDeps extends ControlDeps {
  readonly browserLauncher?: BrowserLauncher;
}

/**
 * The deployed backup services: Redis with its Lua scripts, QStash, the browser that suits the
 * platform (serverless Chromium on Vercel), and the configured supervisor model. The env schema
 * requires `GEMINI_API_KEY` for `gemini`, so the model is always built here.
 */
export function createRuntimeServices(env: WorkerEnv, deps: RuntimeDeps): BackupServices {
  const fetchOption = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  const model = createAgentModel(env, { logger: deps.logger, ...fetchOption });

  return createBackupServices(env, {
    ...(model === undefined ? {} : { agent: { limits: agentLimitsFrom(env), model } }),
    browserLauncher: deps.browserLauncher ?? createBrowserLauncher(),
    jobs: new RedisJobRepository(deps.redis, keyPrefixFor(env.APP_ENV)),
    logger: deps.logger,
    redis: deps.redis,
    scheduler: createQStashScheduler(env, deps),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.ids === undefined ? {} : { ids: deps.ids }),
  });
}

/**
 * `POST /api/jobs/process/[jobId]`. The signature check needs only the signing keys, the URL
 * and Redis; the tick, built after it, needs the whole worker configuration. Either one
 * incomplete answers 503 `CONFIG_INCOMPLETE`.
 */
export async function serveWorker(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: Partial<RuntimeDeps> = {},
): Promise<Response> {
  const logger = overrides.logger ?? runtimeLogger(source);
  let auth: WorkerAuthEnv;

  try {
    auth = loadEnv(workerAuthEnvSchema, source);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('worker.config_incomplete', { invalid: error.invalid, missing: error.missing });

      return configIncomplete();
    }

    throw error;
  }

  const redis =
    overrides.redis ??
    createRedisClient({ token: auth.UPSTASH_REDIS_REST_TOKEN, url: auth.UPSTASH_REDIS_REST_URL });

  return handleWorkerRequest(request, {
    appBaseUrl: auth.APP_BASE_URL,
    clock: overrides.clock ?? systemClock,
    health: new RedisHealthStore(redis, keyPrefixFor(auth.APP_ENV)),
    logger,
    processJob: () =>
      createRuntimeServices(loadEnv(workerEnvSchema, source), { ...overrides, logger, redis })
        .processJob,
    verifier: new QStashSignatureVerifier({
      current: auth.QSTASH_CURRENT_SIGNING_KEY,
      next: auth.QSTASH_NEXT_SIGNING_KEY,
    }),
  });
}

/** The daily routine on the backup services: warnings, probes, the watchdog and the heartbeat. */
export function createDailyMaintenance(
  env: CronEnv,
  services: BackupServices,
  deps: Pick<RuntimeDeps, 'clock' | 'fetch' | 'logger'>,
): DailyMaintenance {
  const clock = deps.clock ?? systemClock;
  const { logger } = deps;

  return new DailyMaintenance({
    autoStart: { dayOfMonth: env.BACKUP_DAY_OF_MONTH, enabled: env.AUTO_START_ENABLED },
    clock,
    health: services.health,
    heartbeat:
      env.HEARTBEAT_PING_URL === undefined
        ? new NoopHeartbeat()
        : new HttpHeartbeat({
            logger,
            url: new SecretValue(env.HEARTBEAT_PING_URL),
            ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
          }),
    jobs: services.jobs,
    logger,
    notionLogin: services.notionLogin,
    policy: policyFrom(env),
    probes: services.probes,
    service: services.service,
    timeZone: env.BACKUP_TIME_ZONE,
    warnings: new LoginWarnings({
      clock,
      gate: services.gate,
      logger,
      notifications: services.notifications,
      warningDays: env.LOGIN_WARNING_DAYS,
    }),
  });
}

/**
 * `GET /api/cron/daily`. The cron secret is checked before anything else is configured or run;
 * the routine, built after it, needs the whole cron configuration. Either one missing answers
 * 503 `CONFIG_INCOMPLETE`.
 */
export async function serveCron(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: Partial<RuntimeDeps> = {},
): Promise<Response> {
  const logger = overrides.logger ?? runtimeLogger(source);
  let cronSecret: string;

  try {
    ({ CRON_SECRET: cronSecret } = loadEnv(cronAuthEnvSchema, source));
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('cron.config_incomplete', { invalid: error.invalid, missing: error.missing });

      return configIncomplete();
    }

    throw error;
  }

  return handleCronRequest(request, {
    cronSecret,
    logger,
    maintenance: () => {
      const env = loadEnv(cronEnvSchema, source);
      const redis =
        overrides.redis ??
        createRedisClient({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL });

      return createDailyMaintenance(
        env,
        createRuntimeServices(env, { ...overrides, logger, redis }),
        { ...overrides, logger },
      );
    },
  });
}
