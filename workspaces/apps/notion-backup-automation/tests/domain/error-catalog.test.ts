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

  it('covers every code the plan names', () => {
    expect(errorCodes.toSorted()).toEqual(
      [
        'BROWSER_LAUNCH_FAILED',
        'CONFIG_INCOMPLETE',
        'DOWNLOAD_FAILED',
        'DOWNLOAD_LINK_EXPIRED',
        'DRIVE_CHECKSUM_MISMATCH',
        'DRIVE_ROOT_INACCESSIBLE',
        'DRIVE_UNAVAILABLE',
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
