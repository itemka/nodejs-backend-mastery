import { addAbortSignal } from 'node:stream';
import { crc32 } from 'node:zlib';
import type { Entry, ZipFile } from 'yauzl';
import { openPromise } from 'yauzl';

import { IntegrationError } from '../../application/integration-error.js';

export interface ZipSummary {
  /** Files in the archive; directory entries are not counted (Notion's export has none). */
  readonly entryCount: number;
  readonly uncompressedBytes: number;
}

/**
 * Checks that the file is a complete, readable ZIP: the central directory, every entry name
 * (yauzl rejects absolute and `..` paths), every entry's decompressed size, and its CRC-32,
 * which yauzl does not check itself. Failures are `ZIP_INVALID` with a static reason: entry
 * names never appear in an error. An aborted `signal` ends the check with its reason.
 */
export async function verifyZipArchive(path: string, signal?: AbortSignal): Promise<ZipSummary> {
  signal?.throwIfAborted();

  let zipfile: ZipFile;

  try {
    zipfile = await openPromise(path, {
      autoClose: true,
      decodeStrings: true,
      strictFileNames: false,
      validateEntrySizes: true,
    });
  } catch {
    throw invalid('it has no readable central directory');
  }

  let entryCount = 0;
  let uncompressedBytes = 0;

  try {
    for await (const entry of zipfile.eachEntry()) {
      signal?.throwIfAborted();

      if (entry.fileName.endsWith('/')) {
        continue;
      }

      await checkEntry(zipfile, entry, signal);
      entryCount += 1;
      uncompressedBytes += entry.uncompressedSize;
    }
  } catch (error) {
    signal?.throwIfAborted();

    if (error instanceof IntegrationError) {
      throw error;
    }

    // yauzl's message may quote an entry name, so it is dropped.
    throw invalid('an entry could not be read');
  } finally {
    zipfile.close();
  }

  if (entryCount === 0) {
    throw invalid('it holds no files');
  }

  return { entryCount, uncompressedBytes };
}

async function checkEntry(
  zipfile: ZipFile,
  entry: Entry,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw invalid('an entry is encrypted or uses an unsupported compression method');
  }

  const stream = await zipfile.openReadStreamPromise(entry);

  if (signal !== undefined) {
    addAbortSignal(signal, stream);
  }

  let crc = 0;

  // The stream errors when the decompressed size differs from the entry's recorded size.
  for await (const chunk of stream) {
    crc = crc32(chunk as Buffer, crc);
  }

  if (crc !== entry.crc32) {
    throw invalid('an entry failed its CRC-32 check');
  }
}

function invalid(reason: string): IntegrationError {
  return new IntegrationError('ZIP_INVALID', `The downloaded file is not a valid ZIP: ${reason}`);
}
