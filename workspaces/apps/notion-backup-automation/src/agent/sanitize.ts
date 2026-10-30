import { MAX_UI_LANDMARK_LENGTH, MAX_UI_LANDMARKS } from '../domain/job.js';
import { redactString } from '../shared/redact.js';

/*
 * What may reach the supervisor model, and what of the model's text may reach you. Everything
 * here is a filter over text the app did not write itself: the Settings page's ARIA names, the
 * job's event lines, and the model's own rationale and summary.
 */

const urlPattern = /\b(?:https?:\/\/|www\.)[^\s"'<>`]+/gi;
const urlStart = /\b(?:https?:\/\/|www\.)/i;
/** Starts only where a run of local-part characters starts, so a failed match is not rescanned. */
const emailPattern = /(?<![\w.%+-])[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Control, format (zero-width, bidirectional) and line-separator characters. */
const controlCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** The ARIA roles a Settings landmark may have; anything else is dropped. */
export const LANDMARK_ROLES = [
  'button',
  'checkbox',
  'combobox',
  'dialog',
  'heading',
  'link',
  'menuitem',
  'option',
  'radio',
  'switch',
  'tab',
  'textbox',
] as const;

const landmarkPattern = new RegExp(`^(${LANDMARK_ROLES.join('|')}):(.*)$`, 's');

/**
 * The names Notion's Settings and export dialog use (Phase 0, S2, the adapter's own labels). A
 * landmark keeps its name only when it is one of these or a redaction mark; any other name,
 * such as the account holder's or a teamspace's, goes as `[other]`, so the model still sees
 * that something else is there but never what.
 */
export const KNOWN_LANDMARK_NAMES = [
  'Account',
  'Billing',
  'Cancel',
  'Close',
  'Connections',
  'Create folders for subpages',
  'Current view',
  'Database views',
  'Default view',
  'Everything',
  'Export',
  'Export format',
  'General',
  'HTML',
  'Identity',
  'Import',
  'Include private pages',
  'Language & region',
  'Markdown & CSV',
  'Members',
  'My account',
  'My connections',
  'My notifications',
  'My settings',
  'No files or images',
  'Notifications',
  'Page content',
  'PDF',
  'People',
  'Plans',
  'Preferences',
  'Security',
  'Settings',
  'Teamspaces',
  'Upgrade',
  'Workspace',
  'Workspace content',
  'Workspace settings',
] as const;

const knownNames = new Set<string>([
  ...KNOWN_LANDMARK_NAMES.map((name) => name.toLowerCase()),
  '[email]',
  '[workspace]',
]);

/** Letters, digits, spaces and plain punctuation: what a Settings label is made of. */
const landmarkName = /^[\p{L}\p{N} .,&'’()/+:-]*$/u;

export interface LandmarkOptions {
  /** Replaced by `[workspace]`: the workspace name is private. */
  readonly workspaceName?: string | undefined;
}

/** Free text from a source the app does not control: no URL, email, secret or control character. */
export function cleanFreeText(text: string, max: number): string {
  const clean = redactString(
    text.replaceAll(controlCharacters, ' ').replaceAll(urlPattern, '[link]'),
  )
    .replaceAll(urlPattern, '[link]')
    .replaceAll(emailPattern, '[email]')
    .replaceAll(/\s+/g, ' ')
    .trim();

  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * ARIA `role:name` pairs from the Settings dialog, made safe to keep and to send: a role from
 * the allowlist, the workspace name and email addresses redacted, and nothing with a URL, a
 * secret or unusual characters. A name that is not a known Settings label goes as `[other]`.
 * Each is cut to 40 characters; duplicates go, and at most 30 stay.
 */
export function sanitizeLandmarks(
  landmarks: readonly string[],
  { workspaceName }: LandmarkOptions = {},
): string[] {
  const kept = new Set<string>();

  for (const raw of landmarks) {
    if (kept.size >= MAX_UI_LANDMARKS) {
      break;
    }

    const landmark = sanitizeLandmark(raw, workspaceName);

    if (landmark !== undefined) {
      kept.add(landmark);
    }
  }

  return [...kept];
}

function sanitizeLandmark(raw: string, workspaceName: string | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.length > 500) {
    return undefined;
  }

  const match = landmarkPattern.exec(raw.trim());

  if (match === null) {
    return undefined;
  }

  const [, role = '', rawName = ''] = match;
  let name = rawName.replaceAll(controlCharacters, ' ').replaceAll(/\s+/g, ' ').trim();

  if (urlStart.test(name) || redactString(name) !== name) {
    return undefined;
  }

  name = name.replaceAll(emailPattern, '[email]');

  const workspace = workspaceName?.trim();

  if (workspace !== undefined && workspace !== '') {
    name = name.replaceAll(workspacePattern(workspace), '[workspace]');
  }

  if (!landmarkName.test(name.replaceAll(/\[(?:email|workspace)\]/g, ''))) {
    return undefined;
  }

  const shown = knownNames.has(name.toLowerCase()) ? name : '[other]';

  return `${role}:${shown}`.slice(0, MAX_UI_LANDMARK_LENGTH);
}

/**
 * The workspace name as Notion shows it: any case, any run of spaces, and `'` and `’` as equal
 * (Notion renders the configured straight apostrophe curly, Phase 0).
 */
function workspacePattern(workspace: string): RegExp {
  const words = workspace
    .split(/\s+/)
    .map((word) =>
      [...word]
        .map((character) =>
          character === "'" || character === '’' ? "['’]" : escapeRegExp(character),
        )
        .join(''),
    );

  return new RegExp(words.join(String.raw`\s+`), 'giu');
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
