import type { OAuth2Client } from 'google-auth-library';

import type { ConsentDependencies } from './oauth-client.js';
import { DRIVE_FILE_SCOPE, runConsent } from './oauth-client.js';

/** The Desktop Google Picker inside the consent screen; it allows only `drive.file`. */
export const PICKER_PARAMS: Readonly<Record<string, string>> = {
  allow_folder_selection: 'true',
  allow_multiple: 'true',
  trigger_onepick: 'true',
};

export interface PickerGrant {
  readonly pickedIds: readonly string[];
  /** Whether the configured backup root was among the picked items. */
  readonly rootPicked: boolean;
}

/**
 * S6 fallback 1 (`auth:google --pick-folders`): a separate `drive.file`-only consent in which
 * you pick `Full Workspace` and the year folder, granting the app access to them. It requests
 * no refresh token, and the short-lived access token it returns is discarded.
 */
export async function grantFoldersWithPicker(
  client: OAuth2Client,
  rootFolderId: string,
  dependencies: ConsentDependencies,
): Promise<PickerGrant> {
  const { callback } = await runConsent(
    client,
    { accessType: 'online', extraParams: PICKER_PARAMS, scopes: [DRIVE_FILE_SCOPE] },
    dependencies,
  );
  const pickedIds = parsePickedIds(callback.get('picked_file_ids'));

  return { pickedIds, rootPicked: pickedIds.includes(rootFolderId) };
}

/** `picked_file_ids` as a list of Drive IDs; separators are commas or whitespace. */
export function parsePickedIds(value: null | string): string[] {
  return (value ?? '').split(/[\s,]+/).filter((id) => /^[\w-]{1,200}$/.test(id));
}
