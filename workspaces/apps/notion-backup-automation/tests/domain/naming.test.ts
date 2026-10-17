import { describe, expect, it } from 'vitest';

import {
  backupFileName,
  DEV_FOLDER_NAME,
  jobIdFor,
  jobIdSchema,
  nextForcedRevision,
  PING_JOB_ID,
  sha256SidecarName,
  yearFolderName,
} from '../../src/domain/naming.js';

describe('job IDs', () => {
  it('uses the period for normal jobs and <period>-r<N> for forced ones', () => {
    expect(jobIdFor('2026-10', 'scheduled')).toBe('2026-10');
    expect(jobIdFor('2026-10', 'manual')).toBe('2026-10');
    expect(jobIdFor('2026-10', 'forced', 2)).toBe('2026-10-r2');
  });

  it.each([undefined, 1, 0, 2.5])('refuses forced revision %s', (revision) => {
    expect(() => jobIdFor('2026-10', 'forced', revision)).toThrow(RangeError);
  });

  it('picks the next forced revision from the period’s existing jobs', () => {
    expect(nextForcedRevision('2026-10', [])).toBe(2);
    expect(nextForcedRevision('2026-10', ['2026-10'])).toBe(2);
    expect(nextForcedRevision('2026-10', ['2026-10', '2026-10-r2', '2026-10-r3'])).toBe(4);
    expect(nextForcedRevision('2026-10', ['2026-09-r7', '2026-10'])).toBe(2);
  });

  it.each(['2026-10', '2026-10-r2', '2026-10-r10'])('accepts %s', (id) => {
    expect(jobIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    '2026-13',
    '2026-10-r1',
    '2026-10-r0',
    '2026-10-r02',
    '26-10',
    PING_JOB_ID,
    '2026-10-x',
  ])('rejects %s', (id) => {
    expect(jobIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('Drive names', () => {
  it('names the ZIP and its checksum sidecar after the local request date', () => {
    expect(backupFileName('2026-10-01')).toBe('notion-workspace-2026-10-01.zip');
    expect(sha256SidecarName('notion-workspace-2026-10-01.zip')).toBe(
      'notion-workspace-2026-10-01.zip.sha256',
    );
    expect(() => backupFileName('2026-10')).toThrow(RangeError);
  });

  it('files a backup under the year of its period', () => {
    expect(yearFolderName('2026-12')).toBe('2026');
    expect(DEV_FOLDER_NAME).toBe('_dev');
  });
});
