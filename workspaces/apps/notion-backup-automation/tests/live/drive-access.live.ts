import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkDriveAccess } from '../../src/adapters/drive/drive-access-check.js';
import { GoogleApiClient } from '../../src/adapters/google/google-api-client.js';
import { OAuthTokenProvider } from '../../src/adapters/google/token-provider.js';
import { driveEnvSchema, loadEnv } from '../../src/config/env.js';
import { periodFor, yearOfPeriod } from '../../src/domain/period.js';

/*
 * Opt-in: `pnpm --filter notion-backup-automation test:live:drive` (sets NBA_LIVE_DRIVE=1).
 * Runs the S6 checks C1–C4 against the real backup root with GOOGLE_REFRESH_TOKEN from
 * `.env.local`. It writes two empty probe files and deletes them again; a probe left behind
 * fails the test. With NBA_DRIVE_MODE=app-owned (S6 fallback 2), only C1 and C3 must pass.
 */
const enabled = process.env.NBA_LIVE_DRIVE === '1';
const envFile = path.resolve(import.meta.dirname, '../../.env.local');

if (enabled && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

describe.runIf(enabled)('live Drive access (S6)', () => {
  it('can use the backup root, and the year folder in "existing" mode', async () => {
    const env = loadEnv(driveEnvSchema, process.env);
    const api = new GoogleApiClient({
      service: 'drive',
      tokenProvider: new OAuthTokenProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: env.GOOGLE_REFRESH_TOKEN,
      }),
    });
    const year = yearOfPeriod(periodFor(new Date(), env.BACKUP_TIME_ZONE));
    const report = await checkDriveAccess({
      api,
      rootFolderId: env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID,
      year,
    });

    console.info(
      report.checks.map(({ detail, id, outcome }) => `${id} ${outcome}: ${detail}`).join('\n'),
    );

    const outcomes = Object.fromEntries(report.checks.map(({ id, outcome }) => [id, outcome]));

    expect(report.leftoverProbeIds).toEqual([]);
    expect(outcomes).toMatchObject({ C1: 'pass', C3: 'pass' });

    if (process.env.NBA_DRIVE_MODE !== 'app-owned') {
      expect(outcomes).toMatchObject({ C2: 'pass', C4: 'pass' });
    }
  });
});
