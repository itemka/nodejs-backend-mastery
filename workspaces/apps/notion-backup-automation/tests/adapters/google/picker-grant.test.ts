import { describe, expect, it } from 'vitest';

import { createOAuthClient } from '../../../src/adapters/google/oauth-client.js';
import {
  grantFoldersWithPicker,
  parsePickedIds,
} from '../../../src/adapters/google/picker-grant.js';
import {
  browserThatConsents,
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
} from '../../support/fake-google.js';

const ROOT_ID = 'root-folder-id';

function setup(pickedIds: string) {
  const google = new FakeGoogle().onToken(() =>
    Response.json({
      access_token: fakeCredentials.accessToken,
      expires_in: 3599,
      scope: DRIVE_SCOPE,
    }),
  );
  const browser = browserThatConsents(() => ({ picked_file_ids: pickedIds }));
  const client = createOAuthClient({
    clientId: fakeCredentials.clientId,
    clientSecret: fakeCredentials.clientSecret,
    fetch: google.fetch,
    retries: 0,
  });

  return { browser, client };
}

describe('grantFoldersWithPicker', () => {
  it('asks for drive.file only, online, with the Picker parameters', async () => {
    const { browser, client } = setup(`${ROOT_ID},year-folder-id`);

    await expect(
      grantFoldersWithPicker(client, ROOT_ID, { openBrowser: browser.openBrowser }),
    ).resolves.toEqual({ pickedIds: [ROOT_ID, 'year-folder-id'], rootPicked: true });

    expect(Object.fromEntries(browser.consentUrls[0]?.searchParams ?? [])).toMatchObject({
      access_type: 'online',
      allow_folder_selection: 'true',
      allow_multiple: 'true',
      prompt: 'consent',
      scope: DRIVE_SCOPE,
      trigger_onepick: 'true',
    });
  });

  it('reports when the configured root was not picked', async () => {
    const { browser, client } = setup('another-folder-id');

    await expect(
      grantFoldersWithPicker(client, ROOT_ID, { openBrowser: browser.openBrowser }),
    ).resolves.toEqual({ pickedIds: ['another-folder-id'], rootPicked: false });
  });
});

describe('parsePickedIds', () => {
  it('splits on commas and whitespace and drops anything that is not an ID', () => {
    expect(parsePickedIds('a1, b_2 c-3,,<x>')).toEqual(['a1', 'b_2', 'c-3']);
    expect(parsePickedIds(null)).toEqual([]);
  });
});
