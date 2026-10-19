import { describe, expect, it } from 'vitest';

import { verifyZipArchive } from '../../../src/adapters/transfer/zip-archive-verifier.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import { tempFile } from '../../support/temp-file.js';
import { zipFixture } from '../../support/zip-fixtures.js';

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(IntegrationError);

  return error as IntegrationError;
}

describe('verifyZipArchive', () => {
  it('accepts a Notion-shaped export and counts its files', async () => {
    await expect(verifyZipArchive(zipFixture('notion-export.zip'))).resolves.toEqual({
      entryCount: 4,
      uncompressedBytes: 54 + 50 + 46 + 231_000,
    });
  });

  it('accepts entries with data descriptors, as in the export Notion sent on 2026-10-18', async () => {
    await expect(verifyZipArchive(zipFixture('data-descriptors.zip'))).resolves.toEqual({
      entryCount: 4,
      uncompressedBytes: 54 + 50 + 46 + 231_000,
    });
  });

  it('accepts directory entries but does not count them', async () => {
    await expect(verifyZipArchive(zipFixture('with-directories.zip'))).resolves.toMatchObject({
      entryCount: 4,
    });
  });

  it.each([
    ['crc-mismatch.zip', 'an entry failed its CRC-32 check'],
    ['truncated.zip', 'it has no readable central directory'],
    ['empty.zip', 'it holds no files'],
    ['path-traversal.zip', 'an entry could not be read'],
    ['encrypted.zip', 'an entry is encrypted or uses an unsupported compression method'],
  ])('rejects %s as ZIP_INVALID: %s', async (fixture, reason) => {
    const error = await rejection(verifyZipArchive(zipFixture(fixture)));

    expect(error.code).toBe('ZIP_INVALID');
    expect(error.message).toBe(`The downloaded file is not a valid ZIP: ${reason}`);
    // Entry names are content: they never reach an error message.
    expect(error.message).not.toMatch(/Export-|outside|Dashboard|\.md/);
  });

  it("rejects the file host's HTML refusal page", async () => {
    const page = await tempFile(Buffer.from('<html><body>Access denied!</body></html>'), 'x.zip');
    const error = await rejection(verifyZipArchive(page));

    expect(error.code).toBe('ZIP_INVALID');
  });

  it('rejects a missing file as ZIP_INVALID', async () => {
    const error = await rejection(verifyZipArchive(zipFixture('missing.zip')));

    expect(error.code).toBe('ZIP_INVALID');
  });

  it('stops with the reason of an aborted signal', async () => {
    const reason = new Error('budget');

    await expect(
      verifyZipArchive(zipFixture('notion-export.zip'), AbortSignal.abort(reason)),
    ).rejects.toBe(reason);
  });

  it('stops with the reason when the signal aborts during the check', async () => {
    const controller = new AbortController();
    const reason = new Error('budget');
    const checking = verifyZipArchive(zipFixture('notion-export.zip'), controller.signal);

    controller.abort(reason);

    await expect(checking).rejects.toBe(reason);
  });
});
