import { DomUtils, ElementType, parseDocument } from 'htmlparser2';

import { SecretValue } from '../../shared/secret-value.js';
import { headerValues, isTrustedByGmail, singleAddress } from './export-email-parser.js';
import type { GmailMessage, GmailMessagePart } from './gmail-schemas.js';

/**
 * Notion's login-code email, as spike S7 recorded it on three days (2026-11-03 to 2026-11-05).
 * Like the export email's, these are constants: a change on Notion's side needs a code change and
 * a review, and until then the automatic login fails closed.
 */
export const LOGIN_EMAIL = {
  /** Gmail's DKIM pass for this identity (selector `smtp`), beside Mailgun's own signature. */
  dkimIdentity: '@updates.notion.com',
  dmarcFromDomain: 'updates.notion.com',
  /** An existing account's code; a sign-up's is refused. */
  emailSubtype: 'existingUser',
  /**
   * The DKIM-signed `X-Feedback-Id`:
   * `<sender>:email_type=sendTemporaryPassword-email_subtype=existingUser:<id>:mailgun`, with the
   * two type fields seen in either order.
   */
  emailType: 'sendTemporaryPassword',
  sender: 'notify@updates.notion.com',
  subject: 'Your temporary Notion login code',
} as const;

/** The code's shape: S7 saw 6 upper- and lowercase letters and digits; 8 leaves some room. */
const CODE_SHAPE = /^[\dA-Za-z]{6,8}$/;

/** A plain word such as "Notion": a code only if nothing else is. */
const PLAIN_WORD = /^[A-Z]?[a-z]+$/;

/** Why a search hit is not the login email. None of these reveal the email's content. */
export type LoginEmailRejection =
  | 'authentication'
  | 'recipient'
  | 'sender'
  | 'stale'
  | 'subject'
  | 'type';

/** The Gmail search for login-code emails received at or after `notBefore`. */
export function loginEmailQuery(notBefore: Date): string {
  const afterSec = Math.floor(notBefore.getTime() / 1000);

  return `from:${LOGIN_EMAIL.sender} subject:"${LOGIN_EMAIL.subject}" after:${afterSec}`;
}

export interface LoginEmailCheck {
  /** The authenticated Gmail profile's address, never inferred from the email itself. */
  readonly expectedRecipient: string;
  /** Emails Gmail received before this answer an earlier request. */
  readonly notBefore: Date;
}

/**
 * The export email's trust checks, for the login email: fresh, the sender, the recipient, the
 * subject, the DKIM-signed type marker, and Gmail's own DKIM and DMARC verdicts for
 * `updates.notion.com`. "A new device logged into your account", which follows each login from
 * the same sender, fails on its subject and type.
 */
export function checkLoginEmail(
  message: GmailMessage,
  { expectedRecipient, notBefore }: LoginEmailCheck,
): LoginEmailRejection | undefined {
  if (Number(message.internalDate) < notBefore.getTime()) {
    return 'stale';
  }

  const headers = message.payload.headers ?? [];

  if (singleAddress(headerValues(headers, 'From')) !== LOGIN_EMAIL.sender) {
    return 'sender';
  }

  if (singleAddress(headerValues(headers, 'To')) !== expectedRecipient.trim().toLowerCase()) {
    return 'recipient';
  }

  const subjects = headerValues(headers, 'Subject');

  if (subjects.length !== 1 || subjects[0]?.trim() !== LOGIN_EMAIL.subject) {
    return 'subject';
  }

  if (!isLoginCodeType(headerValues(headers, 'X-Feedback-Id'))) {
    return 'type';
  }

  // Only the topmost header: Gmail prepends its own, and anything below it came with the message.
  const gmailVerdict = headerValues(headers, 'Authentication-Results')[0];

  return gmailVerdict !== undefined &&
    isTrustedByGmail(gmailVerdict, headerValues(headers, 'DKIM-Signature'), LOGIN_EMAIL)
    ? undefined
    : 'authentication';
}

/**
 * - `none`: no line or element holds a code alone;
 * - `ambiguous`: several do, and neither rule below picks one.
 */
export type LoginCodeResult =
  | { readonly code: SecretValue<string>; readonly ok: true }
  | { readonly ok: false; readonly problem: 'ambiguous' | 'none' };

/**
 * The login code: a value of the code's shape that stands alone on a line of the plain text or
 * alone in an HTML element (S7: the first text line, and a `<pre>`). Hidden HTML (the head,
 * scripts, styles, an inline `display: none` or `visibility: hidden`) is removed first. One
 * distinct value wins; of several, the one found in both parts, then the one of those that is
 * not a plain word. Link targets are not text: the email's magic link also carries the code,
 * and is never read.
 */
export function extractLoginCode(message: GmailMessage): LoginCodeResult {
  const found = new Map<string, Set<'html' | 'text'>>();

  const add = (raw: string, source: 'html' | 'text') => {
    const value = raw.replaceAll(/\s+/g, ' ').trim();

    if (CODE_SHAPE.test(value)) {
      found.set(value, (found.get(value) ?? new Set()).add(source));
    }
  };

  for (const line of (decodePart(message.payload, 'text/plain') ?? '').split(/\r?\n/)) {
    add(line, 'text');
  }

  const html = decodePart(message.payload, 'text/html');

  if (html !== undefined) {
    const { children } = parseDocument(html);

    // Removed first: an ancestor's text would still include them.
    for (const hidden of DomUtils.findAll(isHidden, children)) {
      DomUtils.removeElement(hidden);
    }

    for (const element of DomUtils.findAll(() => true, children)) {
      add(DomUtils.textContent(element), 'html');
    }
  }

  const values = [...found.keys()];
  const confirmed = values.filter((value) => (found.get(value)?.size ?? 0) > 1);
  const unusual = confirmed.filter((value) => !PLAIN_WORD.test(value));
  const winner = ([values, confirmed, unusual].find((list) => list.length === 1) ?? [])[0];

  if (winner === undefined) {
    return { ok: false, problem: values.length === 0 ? 'none' : 'ambiguous' };
  }

  return { code: new SecretValue(winner), ok: true };
}

/** `notify@updates.notion.com:email_type=…-email_subtype=…:<id>:mailgun`, fields in any order. */
function isLoginCodeType(values: readonly string[]): boolean {
  if (values.length !== 1) {
    return false;
  }

  const [sender, typeFields = ''] = (values[0]?.trim() ?? '').split(':');
  const type = /(?:^|-)email_type=([A-Za-z]+)(?:-|$)/.exec(typeFields)?.[1];
  const subtype = /(?:^|-)email_subtype=([A-Za-z]+)(?:-|$)/.exec(typeFields)?.[1];

  return (
    sender?.toLowerCase() === LOGIN_EMAIL.sender &&
    type === LOGIN_EMAIL.emailType &&
    subtype === LOGIN_EMAIL.emailSubtype
  );
}

/** Elements whose text is never shown, so it never holds the code. */
const hiddenElements = new Set<string>([
  ElementType.Script,
  ElementType.Style,
  'head',
  'noscript',
  'template',
  'title',
]);

/** A hidden element, or one an inline style hides (the email's preheader is `display: none`). */
function isHidden(element: Parameters<Parameters<typeof DomUtils.findAll>[0]>[0]): boolean {
  if (hiddenElements.has(element.name)) {
    return true;
  }

  const style = DomUtils.getAttributeValue(element, 'style') ?? '';

  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style);
}

/** The first part of `mimeType`, decoded. */
function decodePart(part: GmailMessagePart, mimeType: string): string | undefined {
  if (part.mimeType?.toLowerCase() === mimeType && part.body?.data !== undefined) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }

  for (const child of part.parts ?? []) {
    const decoded = decodePart(child, mimeType);

    if (decoded !== undefined) {
      return decoded;
    }
  }

  return undefined;
}
