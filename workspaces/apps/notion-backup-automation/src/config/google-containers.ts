import { DriveBackupStorage } from '../adapters/drive/drive-backup-storage.js';
import { DriveHealthProbe } from '../adapters/drive/drive-health-probe.js';
import { ResumableUploader } from '../adapters/drive/resumable-upload.js';
import { GmailApi } from '../adapters/gmail/gmail-api.js';
import { GoogleApiClient } from '../adapters/google/google-api-client.js';
import { GoogleHealthProbe } from '../adapters/google/google-health-probe.js';
import { GoogleRefreshTokenStore } from '../adapters/google/refresh-token-store.js';
import { StoredTokenProvider } from '../adapters/google/token-provider.js';
import type { HealthProbes, SecretStore } from '../application/ports.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import type { BackupEnv } from './env.js';

/*
 * Gmail, Drive and their probes on one Google token: for the worker, the cron and the CLI, and
 * for `/oauth`'s checks after a phone re-login. Nothing here builds a browser.
 */

export type GoogleEnv = Pick<
  BackupEnv,
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID'
  | 'GOOGLE_REFRESH_TOKEN'
  | 'GOOGLE_WEB_CLIENT_ID'
  | 'GOOGLE_WEB_CLIENT_SECRET'
>;

/** What picks and refreshes the token: the OAuth clients and the bootstrap token. */
export type GoogleTokenEnv = Pick<
  GoogleEnv,
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'GOOGLE_REFRESH_TOKEN'
  | 'GOOGLE_WEB_CLIENT_ID'
  | 'GOOGLE_WEB_CLIENT_SECRET'
>;

export interface GoogleServicesDeps {
  /** `APP_ENV=dev`: backups and their year folders go under `_dev`. */
  readonly devFolder: boolean;
  readonly fetch?: typeof fetch;
  readonly ids?: IdGenerator;
  readonly logger: Logger;
  /** Holds the `google-refresh-token` envelope of `APP_ENV`. */
  readonly secrets: SecretStore;
  readonly writeSidecar: boolean;
}

export interface GoogleServices {
  readonly driveApi: GoogleApiClient;
  readonly gmail: GmailApi;
  /** The Google and Drive checks, on the same adapters a backup uses. */
  readonly probes: Pick<HealthProbes, 'drive' | 'google'>;
  /** Where this environment's backups go. */
  readonly storage: DriveBackupStorage;
  readonly tokenProvider: StoredTokenProvider;
}

/**
 * The token provider for `APP_ENV`: the stored envelope with the client it names, else
 * `GOOGLE_REFRESH_TOKEN` with the Desktop client. The CLI also builds it, without `secrets`
 * when Redis is not configured.
 */
export function createTokenProvider(
  env: GoogleTokenEnv,
  deps: Pick<GoogleServicesDeps, 'fetch'> & { readonly secrets?: SecretStore },
): StoredTokenProvider {
  const web =
    env.GOOGLE_WEB_CLIENT_ID === undefined || env.GOOGLE_WEB_CLIENT_SECRET === undefined
      ? {}
      : {
          web: { clientId: env.GOOGLE_WEB_CLIENT_ID, clientSecret: env.GOOGLE_WEB_CLIENT_SECRET },
        };

  return new StoredTokenProvider({
    clients: {
      desktop: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      ...web,
    },
    ...(deps.secrets === undefined ? {} : { store: new GoogleRefreshTokenStore(deps.secrets) }),
    ...(env.GOOGLE_REFRESH_TOKEN === undefined
      ? {}
      : { fallbackRefreshToken: env.GOOGLE_REFRESH_TOKEN }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
}

export function createGoogleServices(env: GoogleEnv, deps: GoogleServicesDeps): GoogleServices {
  const { devFolder, logger } = deps;
  const fetchOption = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  const tokenProvider = createTokenProvider(env, deps);
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
      writeSidecar: deps.writeSidecar,
    });
  const storage = driveStorage(devFolder);
  const googleProbe = new GoogleHealthProbe({ gmail, tokens: tokenProvider });
  const driveProbe = new DriveHealthProbe({
    api: driveApi,
    devStorage: devFolder ? storage : driveStorage(true),
    logger,
    storage,
    ...(deps.ids === undefined ? {} : { ids: deps.ids }),
  });

  return {
    driveApi,
    gmail,
    probes: {
      drive: (period, signal) => driveProbe.run(period, signal),
      google: (signal) => googleProbe.run(signal),
    },
    storage,
    tokenProvider,
  };
}
