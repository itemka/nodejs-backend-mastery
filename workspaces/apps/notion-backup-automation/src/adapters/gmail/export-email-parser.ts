import { DomUtils, ElementType, parseDocument } from 'htmlparser2';

import type { ExportEmailRejection } from '../../application/ports.js';
import { isTrustedByGmail } from './authentication-results.js';
import type { GmailMessage, GmailMessagePart } from './gmail-schemas.js';

/**
 * Notion's "export ready" email, as observed in Phase 0 (2026-09-30 and 2026-10-01). These are
 * constants, not configuration: a change on Notion's side needs a code change and a review.
 */
export const EXPORT_EMAIL = {
  /** Gmail's own `Authentication-Results` must report a DKIM pass for this identity. */
  dkimIdentity: '@mail.notion.com',
  /** …and a DMARC pass for this `From` domain. */
  dmarcFromDomain: 'mail.notion.com',
  /**
   * The DKIM-signed `X-Feedback-Id` names the email type:
   * `<sender>:email_type=sendNotification-email_subtype=export-completed:<id>:mailgun`.
   */
  feedbackSubtype: 'export-completed',
  /** Every link is Mailgun click tracking: `https://mg.mail.notion.com/c/<token>`. */
  linkHost: 'mg.mail.notion.com',
  linkPathPrefix: '/c/',
  /** …in the sentence "Click here to download the export." */
  linkSentence: 'to download the export',
  /** The download link is the only anchor with this text… */
  linkText: 'here',
  sender: 'notify@mail.notion.com',
  subject: 'Your workspace export is ready',
} as const;

/** The search starts this long before the export request: clock skew and a slow click. */
export const SEARCH_SKEW_MS = 10 * 60_000;

/** The Gmail search for export emails received at or after `notBefore`. */
export function exportEmailQuery(notBefore: Date): string {
  const afterSec = Math.floor(notBefore.getTime() / 1000);

  return `from:${EXPORT_EMAIL.sender} subject:"${EXPORT_EMAIL.subject}" after:${afterSec}`;
}

export interface ExportEmailCheck {
  excludeIds: readonly string[];
  /** The authenticated Gmail profile's address, never inferred from the email itself. */
  expectedRecipient: string;
  /** Emails Gmail received before this are stale. */
  notBefore: Date;
}

/**
 * The trust checks, cheapest first: not consumed, fresh, the sender, the recipient, the
 * subject, DKIM-signed type marker, and Gmail's own DKIM and DMARC verdicts. The verified
 * signature must cover the single From, To, Subject and X-Feedback-Id headers.
 */
export function checkExportEmail(
  message: GmailMessage,
  { excludeIds, expectedRecipient, notBefore }: ExportEmailCheck,
): ExportEmailRejection | undefined {
  if (excludeIds.includes(message.id)) {
    return 'consumed';
  }

  if (Number(message.internalDate) < notBefore.getTime()) {
    return 'stale';
  }

  const headers = message.payload.headers ?? [];

  if (singleAddress(headerValues(headers, 'From')) !== EXPORT_EMAIL.sender) {
    return 'sender';
  }

  if (singleAddress(headerValues(headers, 'To')) !== expectedRecipient.trim().toLowerCase()) {
    return 'recipient';
  }

  const subjects = headerValues(headers, 'Subject');

  if (subjects.length !== 1 || subjects[0]?.trim() !== EXPORT_EMAIL.subject) {
    return 'subject';
  }

  if (!isExportCompleted(headerValues(headers, 'X-Feedback-Id'))) {
    return 'type';
  }

  // Only the topmost header: Gmail prepends its own, and anything below it came with the message.
  const gmailVerdict = headerValues(headers, 'Authentication-Results')[0];

  return gmailVerdict !== undefined &&
    isTrustedByGmail(gmailVerdict, headerValues(headers, 'DKIM-Signature'), EXPORT_EMAIL)
    ? undefined
    : 'authentication';
}

export type DownloadLinkProblem =
  | 'html_missing'
  | 'link_count'
  | 'link_invalid'
  | 'sentence_missing';

export type DownloadLinkResult =
  | { readonly link: string; readonly ok: true }
  | { readonly ok: false; readonly problem: DownloadLinkProblem };

/**
 * The Mailgun download link: the single anchor with text "here" in the HTML part, in the email
 * that says "to download the export". It is not decoded or followed here.
 */
export function extractDownloadLink(message: GmailMessage): DownloadLinkResult {
  const html = findHtml(message.payload);

  if (html === undefined) {
    return { ok: false, problem: 'html_missing' };
  }

  const { children } = parseDocument(html);

  if (!textOf(children).toLowerCase().includes(EXPORT_EMAIL.linkSentence)) {
    return { ok: false, problem: 'sentence_missing' };
  }

  const anchors = DomUtils.getElementsByTagName('a', children).filter(
    (anchor) => textOf(anchor.children).toLowerCase() === EXPORT_EMAIL.linkText,
  );
  const [anchor] = anchors;

  if (anchors.length !== 1 || anchor === undefined) {
    return { ok: false, problem: 'link_count' };
  }

  // The parser decodes entities in attribute values.
  const href = DomUtils.getAttributeValue(anchor, 'href')?.trim();

  return href !== undefined && isAllowedDownloadLink(href)
    ? { link: href, ok: true }
    : { ok: false, problem: 'link_invalid' };
}

export function headerValues(
  headers: readonly { name: string; value: string }[],
  name: string,
): string[] {
  const wanted = name.toLowerCase();

  return headers.filter((header) => header.name.toLowerCase() === wanted).map(({ value }) => value);
}

/** A single mailbox address, lowercased; undefined for zero, several or malformed. */
export function singleAddress(values: readonly string[]): string | undefined {
  if (values.length !== 1) {
    return undefined;
  }

  const value = values[0]?.trim() ?? '';
  const angle = /^[^<>,]*<([^\s<>,]+@[^\s<>,]+)>$/.exec(value);
  const bare = /^[^\s<>,]+@[^\s<>,]+$/.exec(value);

  return (angle?.[1] ?? bare?.[0])?.toLowerCase();
}

/** `notify@mail.notion.com:email_type=…-email_subtype=export-completed:<id>:mailgun`. */
function isExportCompleted(values: readonly string[]): boolean {
  if (values.length !== 1) {
    return false;
  }

  const [sender, typeFields] = (values[0]?.trim() ?? '').split(':');
  // The subtype is the last type field; its value has a hyphen, so the fields cannot be split on one.
  const subtype = /(?:^|-)email_subtype=([\w-]+)$/.exec(typeFields ?? '')?.[1];

  return sender?.toLowerCase() === EXPORT_EMAIL.sender && subtype === EXPORT_EMAIL.feedbackSubtype;
}

/** The first `text/html` part, decoded. */
function findHtml(part: GmailMessagePart): string | undefined {
  if (part.mimeType?.toLowerCase() === 'text/html' && part.body?.data !== undefined) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }

  for (const child of part.parts ?? []) {
    const html = findHtml(child);

    if (html !== undefined) {
      return html;
    }
  }

  return undefined;
}

/** Only `https://mg.mail.notion.com/c/<token>`: no other host, port, credentials or path. */
export function isAllowedDownloadLink(href: string): boolean {
  let url: URL;

  try {
    url = new URL(href);
  } catch {
    return false;
  }

  return (
    url.protocol === 'https:' &&
    url.hostname === EXPORT_EMAIL.linkHost &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname.startsWith(EXPORT_EMAIL.linkPathPrefix) &&
    url.pathname.length > EXPORT_EMAIL.linkPathPrefix.length
  );
}

/** Parsed HTML nodes, typed through `DomUtils` so `domhandler` needs no direct dependency. */
type HtmlNodes = Parameters<typeof DomUtils.getElementsByTagType>[1];

/** Their text stays out of the visible text. */
const hiddenTextParents = new Set<string>([ElementType.Script, ElementType.Style]);

/**
 * Visible text: the text nodes outside `<script>` and `<style>`, entities decoded, joined with a
 * space as if every tag were one, and whitespace collapsed.
 */
function textOf(nodes: HtmlNodes): string {
  return DomUtils.getElementsByTagType(ElementType.Text, nodes)
    .filter((node) => !hiddenTextParents.has(node.parent?.type ?? ''))
    .map((node) => DomUtils.textContent(node))
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}
