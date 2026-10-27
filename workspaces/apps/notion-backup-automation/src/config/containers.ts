import type { Redis } from '@upstash/redis';

import { DriveBackupStorage } from '../adapters/drive/drive-backup-storage.js';
import { DriveHealthProbe } from '../adapters/drive/drive-health-probe.js';
import { ResumableUploader } from '../adapters/drive/resumable-upload.js';
import { GmailApi } from '../adapters/gmail/gmail-api.js';
import { GmailExportEmailFinder } from '../adapters/gmail/gmail-export-email-finder.js';
import { GoogleApiClient } from '../adapters/google/google-api-client.js';
import { GoogleHealthProbe } from '../adapters/google/google-health-probe.js';
import { OAuthTokenProvider } from '../adapters/google/token-provider.js';
import { HttpHeartbeat, NoopHeartbeat } from '../adapters/heartbeat/http-heartbeat.js';
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
import type { StringCommands } from '../adapters/persistence/redis-secret-store.js';
import { RedisSecretStore } from '../adapters/persistence/redis-secret-store.js';
import type { QStashApi } from '../adapters/qstash/qstash-scheduler.js';
import { createQStashClient, QStashScheduler } from '../adapters/qstash/qstash-scheduler.js';
import { QStashSignatureVerifier } from '../adapters/qstash/qstash-signature-verifier.js';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import { TmpExportTransfer } from '../adapters/transfer/export-transfer.js';
import { HttpDownloader } from '../adapters/transfer/http-downloader.js';
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
import type { BackupPolicy } from '../domain/policy.js';
import { handleCronRequest } from '../http/cron-handler.js';
import { configIncomplete } from '../http/responses.js';
import { handleWorkerRequest } from '../http/worker-handler.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { createEnvelopeKey } from '../shared/envelope-crypto.js';
import type { IdGenerator } from '../shared/ids.js';
import { randomIds } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { createLogger, logLevels } from '../shared/logger.js';
import { SecretValue } from '../shared/secret-value.js';
import type { BackupEnv, CronEnv, WorkerAuthEnv, WorkerEnv } from './env.js';
import {
  ConfigError,
  cronAuthEnvSchema,
  cronEnvSchema,
  loadEnv,
  workerAuthEnvSchema,
  workerEnvSchema,
} from './env.js';

/*
 * The composition root. Each function builds only what it uses: `/mcp` and the Telegram webhook
 * never construct the backup services, and building them never loads Playwright (the launcher
 * imports it on the first launch).
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

export type NotifierEnv = Pick<
  BackupEnv,
  'APP_ENV' | 'BACKUP_TIME_ZONE' | 'NOTIFIERS' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'
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
    const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = env;

    if (token === undefined || chatId === undefined) {
      logger.warn('notify.telegram.unconfigured', {
        missing: [
          ...(token === undefined ? ['TELEGRAM_BOT_TOKEN'] : []),
          ...(chatId === undefined ? ['TELEGRAM_CHAT_ID'] : []),
        ],
      });
    } else {
      notifiers.push({
        name: 'telegram',
        notifier: new TelegramNotifier({
          appEnv: env.APP_ENV,
          chatId,
          client: new TelegramClient({
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
export type StoreRedis = HashCommands & SetIfAbsentCommands & StringCommands;

export interface BackupServicesDeps {
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
  const processJob = new ProcessJobUseCase({
    clock,
    emails,
    exportShrinkRatio: env.EXPORT_SHRINK_RATIO,
    ids,
    jobs,
    logger,
    notifications,
    policy,
    scheduler,
    storage,
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

export interface RuntimeDeps {
  readonly browserLauncher?: BrowserLauncher;
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
  { logger, qstash }: Pick<RuntimeDeps, 'logger' | 'qstash'>,
): QStashScheduler {
  return new QStashScheduler({
    api: qstash ?? createQStashClient({ baseUrl: env.QSTASH_URL, token: env.QSTASH_TOKEN }),
    appBaseUrl: env.APP_BASE_URL,
    appEnv: env.APP_ENV,
    logger,
  });
}

/**
 * The deployed backup services: Redis with its Lua scripts, QStash, and the browser that suits
 * the platform (serverless Chromium on Vercel).
 */
export function createRuntimeServices(env: WorkerEnv, deps: RuntimeDeps): BackupServices {
  return createBackupServices(env, {
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

/** A JSON-line logger at `LOG_LEVEL`, read leniently: a bad value must not stop a function. */
export function runtimeLogger(source: NodeJS.ProcessEnv = process.env): Logger {
  return createLogger({ level: logLevels.find((level) => level === source.LOG_LEVEL) ?? 'info' });
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
