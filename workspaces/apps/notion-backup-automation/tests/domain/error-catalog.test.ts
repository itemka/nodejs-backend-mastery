import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { errorCatalog, errorCodes } from '../../src/domain/error-catalog.js';

describe('errorCatalog', () => {
  it.each(errorCodes)('%s has static, storable text', (code) => {
    const { description, howToFix } = errorCatalog[code];

    for (const text of [description, howToFix]) {
      expect(text.length).toBeGreaterThan(10);
      expect(text.length).toBeLessThanOrEqual(400);
      expect(text).not.toMatch(/https?:\/\/|\$\{|<|>/);
    }
  });

  // The README lists common fixes only; the full code-to-fix reference is the catalog itself.
  it('names only cataloged codes in the README Common fixes table', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const start = readme.indexOf('### Common fixes');
    const end = readme.indexOf('\n#', start + 1);

    expect(start).toBeGreaterThan(-1);

    const named = readme
      .slice(start, end === -1 ? undefined : end)
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .flatMap((line) => line.split('|')[1]?.match(/(?<=`)[A-Z][A-Z_]+(?=`)/g) ?? []);
    const known = new Set<string>(errorCodes);

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((code) => !known.has(code))).toEqual([]);
  });

  it('never advises a transfer mode that is not built', () => {
    for (const code of errorCodes) {
      expect(errorCatalog[code].howToFix).not.toMatch(/TRANSFER_MODE/);
    }
  });

  it('covers the supported job error codes', () => {
    expect(errorCodes.toSorted()).toEqual(
      [
        'BROWSER_LAUNCH_FAILED',
        'CONFIG_INCOMPLETE',
        'DOWNLOAD_FAILED',
        'DOWNLOAD_LINK_EXPIRED',
        'DRIVE_CHECKSUM_MISMATCH',
        'DRIVE_ROOT_INACCESSIBLE',
        'DRIVE_UNAVAILABLE',
        'EMAIL_SEARCH_LIMIT',
        'EMAIL_TIMEOUT',
        'EMAIL_UNRECOGNIZED',
        'GMAIL_UNAVAILABLE',
        'GOOGLE_AUTH_REQUIRED',
        'INTEGRATION_UNCLASSIFIED',
        'JOB_LIFETIME_EXCEEDED',
        'NOTION_INTERACTIVE_CHALLENGE',
        'NOTION_SESSION_EXPIRED',
        'NOTION_UI_CHANGED',
        'NOTION_UNAVAILABLE',
        'NOTION_WRONG_WORKSPACE',
        'STATE_SCHEMA_INVALID',
        'TMP_SPACE_INSUFFICIENT',
        'TRANSFER_TIMEOUT',
        'UNKNOWN_ERROR',
        'ZIP_INVALID',
      ].toSorted(),
    );
  });

  it('never supervises the codes that need a person (plan: "Never supervised")', () => {
    const unsupervised = errorCodes.filter((code) => !errorCatalog[code].supervised);

    expect(unsupervised.toSorted()).toEqual(
      [
        'CONFIG_INCOMPLETE',
        'DRIVE_ROOT_INACCESSIBLE',
        'EMAIL_TIMEOUT',
        'GOOGLE_AUTH_REQUIRED',
        'JOB_LIFETIME_EXCEEDED',
        'NOTION_INTERACTIVE_CHALLENGE',
        'NOTION_SESSION_EXPIRED',
        'NOTION_WRONG_WORKSPACE',
        'STATE_SCHEMA_INVALID',
        'TMP_SPACE_INSUFFICIENT',
      ].toSorted(),
    );
  });

  it('retries only transient codes', () => {
    const budgets = Object.fromEntries(
      errorCodes
        .filter((code) => errorCatalog[code].retry !== 'none')
        .map((code) => [code, errorCatalog[code].retry]),
    );

    expect(budgets).toEqual({
      BROWSER_LAUNCH_FAILED: 'stage',
      DOWNLOAD_FAILED: 'window',
      DRIVE_UNAVAILABLE: 'window',
      GMAIL_UNAVAILABLE: 'window',
      NOTION_UNAVAILABLE: 'stage',
    });
  });
});
