import { IntegrationError } from '../../application/integration-error.js';
import type { Digests } from '../../shared/digests.js';
import type { Logger } from '../../shared/logger.js';
import type { Sleep } from '../../shared/sleep.js';
import { pause } from '../../shared/sleep.js';
import type { GoogleApiClient } from '../google/google-api-client.js';
import { GoogleApiError } from '../google/google-api-client.js';
import { accessError, errorCode } from './drive-common.js';
import type { DriveFile } from './drive-schemas.js';
import { DRIVE_API_URL, driveFileSchema } from './drive-schemas.js';
import type { DriveUploadMetadata, ResumableUploader, UploadSource } from './resumable-upload.js';

const CHECKSUM_FIELDS = 'id,size,sha256Checksum';

/**
 * Drive may report the SHA-256 a moment after the upload: it is asked again after each of these
 * waits. Upload and discovery check the same SHA-256, so a stored backup can always be found.
 */
const CHECKSUM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export interface VerifiedUploaderOptions {
  readonly api: GoogleApiClient;
  readonly logger: Logger;
  readonly sleep: Sleep;
  readonly uploader: ResumableUploader;
}

/**
 * Uploads a file, then compares Drive's size and SHA-256 with the local digests. Unless they
 * match, the new file is deleted: a mismatch, no SHA-256, or a failure to read it.
 */
export class VerifiedUploader {
  constructor(private readonly options: VerifiedUploaderOptions) {}

  /** The new file's id, once Drive's own size and SHA-256 match `expected`. */
  async upload(
    metadata: DriveUploadMetadata,
    source: UploadSource,
    expected: Digests,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    let fileId: string;

    try {
      ({ fileId } = await this.options.uploader.upload(metadata, source, signal));
    } catch (error) {
      throw accessError(error, 'Cannot create a file in the year folder');
    }

    let file: DriveFile;

    try {
      file = await this.readChecksum(fileId, signal);
    } catch (error) {
      await this.deleteUploaded(fileId);

      throw error;
    }

    const problem = checksumProblem(file, expected);

    if (problem === undefined) {
      return fileId;
    }

    const deleted = await this.deleteUploaded(fileId);
    const outcome = deleted ? 'the file was deleted' : `delete file ${fileId} in Drive`;

    this.options.logger.warn('drive.upload.unverified', { driveFileId: fileId, problem });

    if (problem === 'no SHA-256') {
      throw new IntegrationError(
        'DRIVE_UNAVAILABLE',
        `Drive reported no SHA-256 for the upload; ${outcome}`,
      );
    }

    throw new IntegrationError(
      'DRIVE_CHECKSUM_MISMATCH',
      `Drive's ${problem} did not match the upload; ${outcome}`,
    );
  }

  /** Deletes a file the app just uploaded; false when it could not. */
  private async deleteUploaded(fileId: string): Promise<boolean> {
    try {
      await this.options.api.send({
        method: 'DELETE',
        query: { supportsAllDrives: true },
        url: `${DRIVE_API_URL}/files/${fileId}`,
      });

      return true;
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        return true;
      }

      this.options.logger.warn('drive.upload.delete_failed', {
        code: errorCode(error),
        driveFileId: fileId,
      });

      return false;
    }
  }

  /** Drive's size and SHA-256, asked again while Drive has not computed the SHA-256 yet. */
  private async readChecksum(fileId: string, signal: AbortSignal | undefined): Promise<DriveFile> {
    const read = () =>
      this.options.api.json(driveFileSchema, {
        query: { fields: CHECKSUM_FIELDS, supportsAllDrives: true },
        signal,
        url: `${DRIVE_API_URL}/files/${fileId}`,
      });
    let file = await read();

    for (const delayMs of CHECKSUM_RETRY_DELAYS_MS) {
      if (file.sha256Checksum !== undefined) {
        break;
      }

      await pause(this.options.sleep, delayMs, signal);
      file = await read();
    }

    return file;
  }
}

/** Discovery (`verifiedBackup`) checks the same SHA-256, so an accepted upload is always found. */
function checksumProblem(
  file: DriveFile,
  expected: Digests,
): 'no SHA-256' | 'SHA-256' | 'size' | undefined {
  if (file.size !== undefined && file.size !== expected.sizeBytes) {
    return 'size';
  }

  if (file.sha256Checksum === undefined) {
    return 'no SHA-256';
  }

  return file.sha256Checksum === expected.sha256 ? undefined : 'SHA-256';
}
