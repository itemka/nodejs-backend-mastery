import { DriveBackupStorage } from '../adapters/drive/drive-backup-storage.js';
import { ResumableUploader } from '../adapters/drive/resumable-upload.js';
import { GmailApi } from '../adapters/gmail/gmail-api.js';
import { GmailExportEmailFinder } from '../adapters/gmail/gmail-export-email-finder.js';
import { GoogleApiClient } from '../adapters/google/google-api-client.js';
import { OAuthTokenProvider } from '../adapters/google/token-provider.js';
import type { NamedNotifier } from '../adapters/notifications/composite-notifier.js';
import { CompositeNotifier } from '../adapters/notifications/composite-notifier.js';
import { ConsoleNotifier } from '../adapters/notifications/console-notifier.js';
import { TelegramNotifier } from '../adapters/notifications/telegram-notifier.js';
import type { BrowserLauncher } from '../adapters/notion/browser-launcher.js';
import { PlaywrightNotionExportTrigger } from '../adapters/notion/notion-export-trigger.js';
import { NotionSessionStore } from '../adapters/notion/notion-session.js';
import { keyPrefixFor } from '../adapters/persistence/keys.js';
import type { HashCommands } from '../adapters/persistence/redis-health-store.js';
import { RedisHealthStore } from '../adapters/persistence/redis-health-store.js';
import type { SetIfAbsentCommands } from '../adapters/persistence/redis-notification-gate.js';
import { RedisNotificationGate } from '../adapters/persistence/redis-notification-gate.js';
import type { StringCommands } from '../adapters/persistence/redis-secret-store.js';
import { RedisSecretStore } from '../adapters/persistence/redis-secret-store.js';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import { TmpExportTransfer } from '../adapters/transfer/export-transfer.js';
import { HttpDownloader } from '../adapters/transfer/http-downloader.js';
import { BackupApplicationService } from '../application/backup-service.js';
import { JobNotifications } from '../application/job-notifications.js';
import type { JobRepository, Notifier, Scheduler } from '../application/ports.js';
import { ProcessJobUseCase } from '../application/process-job.js';
import type { BackupPolicy } from '../domain/policy.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { createEnvelopeKey } from '../shared/envelope-crypto.js';
import type { IdGenerator } from '../shared/ids.js';
import { randomIds } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { SecretValue } from '../shared/secret-value.js';
import type { BackupEnv } from './env.js';

/*
 * The composition root. Each function builds only what it uses: `/mcp` and the Telegram webhook
 * never construct the backup services, and building them never loads Playwright (the launcher
 * imports it on the first launch).
 */

export function policyFrom(env: BackupEnv): BackupPolicy {
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
  readonly jobs: JobRepository;
  readonly notifications: JobNotifications;
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
  const emails = new GmailExportEmailFinder({
    gmail: new GmailApi(new GoogleApiClient({ service: 'gmail', tokenProvider, ...fetchOption })),
    logger,
  });
  const storage = new DriveBackupStorage({
    api: new GoogleApiClient({ service: 'drive', tokenProvider, ...fetchOption }),
    devFolder,
    logger,
    rootFolderId: env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID,
    uploader: new ResumableUploader({ tokenProvider, ...fetchOption }),
    writeSidecar: env.WRITE_SHA256_SIDECAR,
  });
  const notifications = new JobNotifications({
    clock,
    devFolder,
    gate: new RedisNotificationGate(redis, keyPrefix, clock),
    health: new RedisHealthStore(redis, keyPrefix),
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
    trigger: new PlaywrightNotionExportTrigger({
      exportFormat: env.NOTION_EXPORT_FORMAT,
      launcher: browserLauncher,
      logger,
      sessions: new NotionSessionStore({ secrets }),
      workspace: { name: env.NOTION_WORKSPACE_NAME, url: env.NOTION_WORKSPACE_URL },
    }),
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

  return { jobs, notifications, processJob, service };
}
