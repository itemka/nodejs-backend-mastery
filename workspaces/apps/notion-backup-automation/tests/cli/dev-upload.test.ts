import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { main } from '../../src/cli/main.js';
import { testCli } from '../support/cli-context.js';
import { FakeDrive, ROOT_ID } from '../support/fake-drive.js';
import { fakeCredentials, googleError } from '../support/fake-google.js';
import { ManualClock } from '../support/manual-clock.js';
import { tempFile } from '../support/temp-file.js';

const NAME = 'notion-workspace-2026-10-18.zip';
const env = {
  APP_ENV: 'dev',
  GOOGLE_CLIENT_ID: fakeCredentials.clientId,
  GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
  GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: ROOT_ID,
  GOOGLE_REFRESH_TOKEN: fakeCredentials.refreshToken,
};

describe('dev:upload', () => {
  it('uploads the file as today’s backup into _dev/<YYYY>/, with its sidecar', async () => {
    const drive = new FakeDrive();
    const content = randomBytes(5000);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const { context, text } = await testCli({ env, fetch: drive.fetch });

    drive.add({ name: '2026' });

    await expect(main(['dev:upload', await tempFile(content)], context)).resolves.toBe(0);

    const [dev] = drive.named('_dev');
    const [year] = drive.childrenOf(dev?.id ?? '');

    expect(year?.name).toBe('2026');
    expect(
      drive
        .childrenOf(year?.id ?? '')
        .map((file) => file.name)
        .toSorted(),
    ).toEqual([NAME, `${NAME}.sha256`]);
    expect(text()).toContain(`✓ Uploaded _dev/2026/${NAME}; Drive's checksum matches.`);
    expect(text()).toContain(`  size           5000 bytes`);
    expect(text()).toContain(`  SHA-256        ${sha256}`);
    expect(text()).toContain('  sidecar        written');
    // Your real year folder stays untouched.
    expect(drive.childrenOf(drive.named('2026')[0]?.id ?? '')).toEqual([]);
  });

  it('uploads nothing when run again with the same file', async () => {
    const drive = new FakeDrive();
    const file = await tempFile(randomBytes(5000));
    const first = await testCli({ env, fetch: drive.fetch });
    const second = await testCli({ env, fetch: drive.fetch });

    await main(['dev:upload', file], first.context);
    const sessions = drive.sessionCount;

    await expect(main(['dev:upload', file], second.context)).resolves.toBe(0);
    expect(drive.sessionCount).toBe(sessions);
    expect(second.text()).toContain(
      `✓ _dev/2026/${NAME} is already in Drive with the same SHA-256; nothing was uploaded.`,
    );
    expect(second.text()).toContain('  sidecar        already in Drive');
  });

  it('names the copy in Drive when the same file was uploaded on an earlier day', async () => {
    const drive = new FakeDrive();
    const file = await tempFile(randomBytes(5000));
    const first = await testCli({ env, fetch: drive.fetch });
    const later = await testCli({
      clock: new ManualClock('2026-10-19T10:00:00.000Z'),
      env,
      fetch: drive.fetch,
    });

    await main(['dev:upload', file], first.context);

    await expect(main(['dev:upload', file], later.context)).resolves.toBe(0);
    expect(later.text()).toContain(
      `✓ _dev/2026/${NAME} is already in Drive with the same SHA-256; nothing was uploaded.`,
    );
    expect(drive.named('notion-workspace-2026-10-19.zip')).toEqual([]);
  });

  it('refuses to run unless APP_ENV=dev, before any Drive request', async () => {
    const drive = new FakeDrive();
    const { context, text } = await testCli({
      env: { ...env, APP_ENV: 'prod' },
      fetch: drive.fetch,
    });

    await expect(main(['dev:upload', await tempFile(randomBytes(10))], context)).resolves.toBe(1);
    expect(text()).toContain('dev:upload writes only to the _dev folder: run it with APP_ENV=dev.');
    expect(drive.google.requests).toEqual([]);
  });

  it('reports a file that does not exist', async () => {
    const drive = new FakeDrive();
    const { context, text } = await testCli({ env, fetch: drive.fetch });

    await expect(main(['dev:upload', '/nonexistent/backup.zip'], context)).resolves.toBe(1);
    expect(text()).toContain('The file does not exist or is not a regular file.');
    expect(drive.google.requests).toEqual([]);
  });

  it('exits 1 when the ZIP is stored but its sidecar failed', async () => {
    const drive = new FakeDrive();
    const { context, text } = await testCli({ env, fetch: drive.fetch });

    drive.onStart = (attempt) => (attempt === 2 ? googleError(400, 'badRequest') : undefined);

    await expect(main(['dev:upload', await tempFile(randomBytes(10))], context)).resolves.toBe(1);
    expect(drive.named(NAME)).toHaveLength(1);
    expect(text()).toContain('Run dev:upload again to retry the sidecar.');
  });
});
