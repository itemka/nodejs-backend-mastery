import { readFile, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { main } from '../../src/cli/main.js';
import { testCli } from '../support/cli-context.js';
import {
  browserThatConsents,
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  googleError,
  GMAIL_SCOPE,
} from '../support/fake-google.js';
import { ManualClock } from '../support/manual-clock.js';

const PROFILE = 'gmail.googleapis.com/gmail/v1/users/me/profile';
const clientEnv = {
  GOOGLE_CLIENT_ID: fakeCredentials.clientId,
  GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
};

function fakeGoogle(scope = `${GMAIL_SCOPE} ${DRIVE_SCOPE}`) {
  return new FakeGoogle()
    .onToken(() =>
      Response.json({
        access_token: fakeCredentials.accessToken,
        expires_in: 3599,
        refresh_token: fakeCredentials.refreshToken,
        scope,
        token_type: 'Bearer',
      }),
    )
    .on('GET', PROFILE, () => Response.json({ emailAddress: 'artsem@example.com' }));
}

async function setup(google = fakeGoogle(), env: Record<string, string> = clientEnv) {
  const browser = browserThatConsents((url) =>
    url.searchParams.has('trigger_onepick') ? { picked_file_ids: 'root-folder-id,year-id' } : {},
  );
  const cli = await testCli({ env, fetch: google.fetch, openBrowser: browser.openBrowser });

  return { ...cli, browser, google };
}

describe('auth:google', () => {
  it('writes the refresh token into .env.local in place, with mode 0600', async () => {
    const { context } = await setup();

    await writeFile(
      context.envFilePath,
      '# Google\nGOOGLE_CLIENT_ID=kept\nGOOGLE_REFRESH_TOKEN=old-value\nAPP_ENV=dev\n',
      { mode: 0o644 },
    );

    await expect(main(['auth:google'], context)).resolves.toBe(0);

    expect(await readFile(context.envFilePath, 'utf8')).toBe(
      `# Google\nGOOGLE_CLIENT_ID=kept\nGOOGLE_REFRESH_TOKEN=${fakeCredentials.refreshToken}\nAPP_ENV=dev\n`,
    );
    const { mode } = await stat(context.envFilePath);

    expect(mode & 0o777).toBe(0o600);
  });

  it('prints only the masked token, the masked mailbox and the scopes', async () => {
    const { context, text } = await setup();

    await main(['auth:google'], context);

    expect(text()).toContain('token    1//0g…xYz4');
    expect(text()).toContain('mailbox  a***@example.com');
    expect(text()).toContain('scopes   gmail.readonly, drive.file');
    expect(text()).toContain('labelled "temporary, Testing, 2026-10-18"');
    expect(text()).not.toContain(fakeCredentials.refreshToken);
    expect(text()).not.toContain(fakeCredentials.accessToken);
    expect(text()).not.toContain('artsem@');
  });

  it('dates the 1Password label in the backup time zone', async () => {
    const google = fakeGoogle();
    const { openBrowser } = browserThatConsents();
    // 22:30 UTC on 17 October is already 18 October in Warsaw.
    const { context, text } = await testCli({
      clock: new ManualClock('2026-10-17T22:30:00.000Z'),
      env: clientEnv,
      fetch: google.fetch,
      openBrowser,
    });

    await main(['auth:google'], context);

    expect(text()).toContain('labelled "temporary, Testing, 2026-10-18"');
  });

  it('prints the token itself only with --print', async () => {
    const { context, output } = await setup();

    await main(['auth:google', '--print'], context);

    expect(output).toContain(fakeCredentials.refreshToken);
  });

  it('still saves the token when the mailbox cannot be read', async () => {
    const google = fakeGoogle().on('GET', PROFILE, () => googleError(401));
    const { context, text } = await setup(google);

    await expect(main(['auth:google'], context)).resolves.toBe(0);

    expect(text()).toContain('mailbox  unavailable (GOOGLE_AUTH_REQUIRED)');
    expect(await readFile(context.envFilePath, 'utf8')).toContain('GOOGLE_REFRESH_TOKEN=');
  });

  it('fails without touching .env.local when a scope was not granted', async () => {
    const { context, text } = await setup(fakeGoogle(GMAIL_SCOPE));

    await writeFile(context.envFilePath, 'GOOGLE_REFRESH_TOKEN=old-value\n');

    await expect(main(['auth:google'], context)).resolves.toBe(1);

    expect(text()).toContain('MISSING_SCOPES: Not granted: drive.file');
    expect(await readFile(context.envFilePath, 'utf8')).toBe('GOOGLE_REFRESH_TOKEN=old-value\n');
  });

  it('names the missing client variables, never their values', async () => {
    const { context, text } = await setup(fakeGoogle(), { GOOGLE_CLIENT_ID: 'present-client-id' });

    await expect(main(['auth:google'], context)).resolves.toBe(1);

    expect(text()).toContain('missing GOOGLE_CLIENT_SECRET');
    expect(text()).not.toContain('present-client-id');
  });
});

describe('auth:google --pick-folders', () => {
  const pickerEnv = { ...clientEnv, GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: 'root-folder-id' };

  it('grants the picked folders and saves nothing', async () => {
    const { browser, context, text } = await setup(fakeGoogle(DRIVE_SCOPE), pickerEnv);

    await expect(main(['auth:google', '--pick-folders'], context)).resolves.toBe(0);

    expect(browser.consentUrls[0]?.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(text()).toContain('picked items  2\n    root-folder-id\n    year-id');
    expect(text()).toContain('The backup root was granted');
    await expect(readFile(context.envFilePath, 'utf8')).rejects.toThrow('ENOENT');
  });

  it('fails when the configured root was not picked', async () => {
    const { context, text } = await setup(fakeGoogle(DRIVE_SCOPE), {
      ...pickerEnv,
      GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: 'another-root-id',
    });

    await expect(main(['auth:google', '--pick-folders'], context)).resolves.toBe(1);

    expect(text()).toContain(
      'GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID (another-root-id) was not among the picked items.',
    );
    expect(text()).toContain(
      'Pick the configured root, or correct GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID.',
    );
  });
});
