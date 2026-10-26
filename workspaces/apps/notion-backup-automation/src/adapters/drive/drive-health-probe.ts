import { IntegrationError } from '../../application/integration-error.js';
import type { DriveProbeResult } from '../../application/ports.js';
import type { Period } from '../../domain/period.js';
import type { IdGenerator } from '../../shared/ids.js';
import { randomIds } from '../../shared/ids.js';
import type { Logger } from '../../shared/logger.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { probeWrite } from './drive-access-check.js';
import type { DriveBackupStorage } from './drive-backup-storage.js';

export interface DriveHealthProbeOptions {
  readonly api: GoogleApiClient;
  /** Storage under `_dev`: the write probe never touches your backup folders. */
  readonly devStorage: Pick<DriveBackupStorage, 'ensureYearFolder'>;
  readonly ids?: IdGenerator;
  readonly logger: Logger;
  /** The backups' own storage: the root and the year folder they go to. */
  readonly storage: Pick<DriveBackupStorage, 'ensureYearFolder' | 'rootMode'>;
}

/**
 * The Drive probe: the root is a visible, writable folder; the period's year folder resolves
 * as a backup would resolve it; and a probe file is created and deleted under `_dev/<YYYY>`.
 * Folder access failures throw `DRIVE_ROOT_INACCESSIBLE`. A probe file left behind by an auth
 * or availability failure keeps that failure's code, so it never reads as lost folder access.
 */
export class DriveHealthProbe {
  private readonly api: GoogleApiClient;
  private readonly devStorage: Pick<DriveBackupStorage, 'ensureYearFolder'>;
  private readonly ids: IdGenerator;
  private readonly logger: Logger;
  private readonly storage: Pick<DriveBackupStorage, 'ensureYearFolder' | 'rootMode'>;

  constructor({ api, devStorage, ids = randomIds, logger, storage }: DriveHealthProbeOptions) {
    this.api = api;
    this.devStorage = devStorage;
    this.ids = ids;
    this.logger = logger;
    this.storage = storage;
  }

  async run(period: Period, signal?: AbortSignal): Promise<DriveProbeResult> {
    const mode = await this.storage.rootMode(signal);

    await this.storage.ensureYearFolder(period, signal);

    const devYearId = await this.devStorage.ensureYearFolder(period, signal);

    signal?.throwIfAborted();

    const write = await probeWrite(this.api, devYearId, `.nba-access-probe-${this.ids.shortId()}`);

    if (write.leftoverIds.length > 0) {
      // File IDs only; delete them in Drive.
      this.logger.warn('drive.probe.leftover', { fileIds: write.leftoverIds });
    }

    if (!write.ok) {
      throw new IntegrationError(
        write.failureCode ?? 'DRIVE_ROOT_INACCESSIBLE',
        `The _dev folder: ${write.detail}`,
      );
    }

    return { mode };
  }
}
