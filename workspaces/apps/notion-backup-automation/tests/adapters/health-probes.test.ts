import { describe, expect, it } from 'vitest';

import { DriveBackupStorage } from '../../src/adapters/drive/drive-backup-storage.js';
import { DriveHealthProbe } from '../../src/adapters/drive/drive-health-probe.js';
import { ResumableUploader } from '../../src/adapters/drive/resumable-upload.js';
import { GmailApi } from '../../src/adapters/gmail/gmail-api.js';
import { GoogleApiClient } from '../../src/adapters/google/google-api-client.js';
import { GoogleHealthProbe } from '../../src/adapters/google/google-health-probe.js';
import { OAuthTokenProvider } from '../../src/adapters/google/token-provider.js';
import { createLogger } from '../../src/shared/logger.js';
import { FakeDrive, FOLDER_MIME_TYPE, ROOT_ID } from '../support/fake-drive.js';
import {
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  GMAIL_SCOPE,
  googleError,
} from '../support/fake-google.js';

const PROFILE = 'gmail.googleapis.com/gmail/v1/users/me/profile';
const logs: string[] = [];
const logger = createLogger({
  sink: (_level, line) => {
    logs.push(line);
  },
});

function googleProbe(google: FakeGoogle): GoogleHealthProbe {
  const tokens = new OAuthTokenProvider({
    clientId: fakeCredentials.clientId,
    clientSecret: fakeCredentials.clientSecret,
    fetch: google.fetch,
    refreshToken: fakeCredentials.refreshToken,
  });

  return new GoogleHealthProbe({
    gmail: new GmailApi(
      new GoogleApiClient({ fetch: google.fetch, service: 'gmail', tokenProvider: tokens }),
    ),
    tokens,
  });
}

describe('GoogleHealthProbe', () => {
  it('refreshes the token, reads the mailbox profile, and reports only the scopes', async () => {
    const google = new FakeGoogle()
      .onRefresh(`${GMAIL_SCOPE} ${DRIVE_SCOPE}`)
      .on('GET', PROFILE, () => Response.json({ emailAddress: 'owner@example.com' }));

    await expect(googleProbe(google).run()).resolves.toEqual({
      scopes: ['gmail.readonly', 'drive.file'],
    });
    expect(google.requestsTo(PROFILE)).toHaveLength(1);
  });

  it('reports a rejected or narrowed token as GOOGLE_AUTH_REQUIRED', async () => {
    const rejected = new FakeGoogle().onToken(() =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    const narrowed = new FakeGoogle().onRefresh(GMAIL_SCOPE);

    await expect(googleProbe(rejected).run()).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
    });
    await expect(googleProbe(narrowed).run()).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
    });
  });

  it('reports a token endpoint outage as GMAIL_UNAVAILABLE, not as a lost login', async () => {
    const down = new FakeGoogle().onToken(() => Response.json({}, { status: 503 }));

    await expect(googleProbe(down).run()).rejects.toMatchObject({ code: 'GMAIL_UNAVAILABLE' });
  });
});

function driveProbe(drive: FakeDrive): DriveHealthProbe {
  const tokenProvider = { getAccessToken: () => Promise.resolve('fake-access-token') };
  const api = new GoogleApiClient({ fetch: drive.fetch, service: 'drive', tokenProvider });
  const storage = (devFolder: boolean) =>
    new DriveBackupStorage({
      api,
      devFolder,
      logger,
      rootFolderId: ROOT_ID,
      uploader: new ResumableUploader({ fetch: drive.fetch, tokenProvider }),
      writeSidecar: true,
    });

  return new DriveHealthProbe({ api, devStorage: storage(true), logger, storage: storage(false) });
}

describe('DriveHealthProbe', () => {
  it('resolves your year folder, then creates and deletes a probe file under _dev only', async () => {
    const drive = new FakeDrive();
    const year = drive.add({ mimeType: FOLDER_MIME_TYPE, name: '2026' });

    await expect(driveProbe(drive).run('2026-10')).resolves.toEqual({ mode: 'existing' });

    const [dev] = drive.named('_dev');
    const devYear = drive.childrenOf(dev?.id ?? '').find((file) => file.name === '2026');

    expect(drive.childrenOf(year.id)).toEqual([]);
    expect(devYear).toBeDefined();
    expect(drive.childrenOf(devYear?.id ?? '')).toEqual([]);
    expect(drive.google.requestsTo('www.googleapis.com/drive/v3/files/')).toContainEqual(
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('reports a root the app cannot see as DRIVE_ROOT_INACCESSIBLE', async () => {
    const drive = new FakeDrive();

    drive.invisible.add(ROOT_ID);

    await expect(driveProbe(drive).run('2026-10')).rejects.toMatchObject({
      code: 'DRIVE_ROOT_INACCESSIBLE',
    });
  });

  it.each([
    [401, 'GOOGLE_AUTH_REQUIRED'],
    [503, 'DRIVE_UNAVAILABLE'],
    [403, 'DRIVE_ROOT_INACCESSIBLE'],
  ])(
    'keeps the code of HTTP %s while deleting the probe file, and logs its ID',
    async (status, code) => {
      const drive = new FakeDrive();

      drive.add({ mimeType: FOLDER_MIME_TYPE, name: '2026' });
      drive.google.on('DELETE', 'www.googleapis.com/drive/v3/files/*', () =>
        googleError(status, status === 403 ? 'insufficientFilePermissions' : undefined),
      );
      logs.length = 0;

      await expect(driveProbe(drive).run('2026-10')).rejects.toMatchObject({ code });

      const leftover = [...drive.files.values()].find((file) =>
        file.name.startsWith('.nba-access-probe-'),
      );

      expect(leftover).toBeDefined();
      expect(logs.find((line) => line.includes('drive.probe.leftover'))).toContain(leftover?.id);
    },
  );
});
