import type { ExportEmailRejection } from '../../application/ports.js';
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
  gmailAuthservId: 'mx.google.com',
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
    isTrustedByGmail(gmailVerdict, headerValues(headers, 'DKIM-Signature'))
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

  if (!textOf(html).toLowerCase().includes(EXPORT_EMAIL.linkSentence)) {
    return { ok: false, problem: 'sentence_missing' };
  }

  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].filter(
    (anchor) => textOf(anchor[2] ?? '').toLowerCase() === EXPORT_EMAIL.linkText,
  );

  if (anchors.length !== 1) {
    return { ok: false, problem: 'link_count' };
  }

  const href = hrefOf(anchors[0]?.[1] ?? '');

  return href !== undefined && isAllowedLink(href)
    ? { link: href, ok: true }
    : { ok: false, problem: 'link_invalid' };
}

export interface AuthenticationResult {
  method: string;
  properties: Readonly<Record<string, string>>;
  result: string;
}

export interface AuthenticationResults {
  authservId: string;
  results: AuthenticationResult[];
}

/**
 * Parses an `Authentication-Results` value (RFC 8601): `authserv-id; method=result
 * ptype.property=value …; …`. Comments are dropped; method names, results and the
 * authserv-id are lowercased.
 */
export function parseAuthenticationResults(value: string): AuthenticationResults {
  let text = value.replaceAll(/\s+/g, ' ');
  let previous = '';

  // Comments may nest, so strip the innermost ones until none are left.
  while (text !== previous) {
    previous = text;
    text = text.replaceAll(/\([^()]*\)/g, ' ');
  }

  const [head = '', ...sections] = text.split(';');
  const results: AuthenticationResult[] = [];

  for (const section of sections) {
    const [methodResult, ...pairs] = section.trim().split(' ');
    const [method, result] = (methodResult ?? '').split('=');

    if (method === undefined || method === '' || result === undefined) {
      continue;
    }

    const properties: Record<string, string> = {};

    for (const pair of pairs) {
      const separator = pair.indexOf('=');

      if (separator > 0) {
        properties[pair.slice(0, separator).toLowerCase()] = pair
          .slice(separator + 1)
          .replaceAll('"', '');
      }
    }

    results.push({ method: method.toLowerCase(), properties, result: result.toLowerCase() });
  }

  return { authservId: (head.trim().split(' ')[0] ?? '').toLowerCase(), results };
}

/** Gmail's verdict: a DKIM pass for Notion's identity and a DMARC pass for its `From` domain. */
function isTrustedByGmail(value: string, signatures: readonly string[]): boolean {
  const { authservId, results } = parseAuthenticationResults(value);

  if (authservId !== EXPORT_EMAIL.gmailAuthservId) {
    return false;
  }

  const dkim = results.some(
    (result) =>
      result.method === 'dkim' &&
      result.result === 'pass' &&
      result.properties['header.i']?.toLowerCase() === EXPORT_EMAIL.dkimIdentity &&
      hasSignedTrustHeaders(result, signatures),
  );
  const dmarc = results.some(
    ({ method, properties, result }) =>
      method === 'dmarc' &&
      result === 'pass' &&
      properties['header.from']?.toLowerCase() === EXPORT_EMAIL.dmarcFromDomain,
  );

  return dkim && dmarc;
}

/** RFC 6008: header.b identifies the verified signature by a case-sensitive, unique prefix. */
function hasSignedTrustHeaders(
  result: AuthenticationResult,
  signatures: readonly string[],
): boolean {
  const prefix = result.properties['header.b'];
  const selector = result.properties['header.s'];

  if (prefix === undefined || prefix === '' || selector === undefined) {
    return false;
  }

  const matches = signatures.flatMap((value) => {
    const tags = dkimTags(value);
    const signature = tags?.get('b')?.replaceAll(/\s/g, '');

    return tags !== undefined && signature?.startsWith(prefix) ? [tags] : [];
  });
  const tags = matches.length === 1 ? matches[0] : undefined;

  if (tags === undefined) {
    return false;
  }

  const signature = tags.get('b')?.replaceAll(/\s/g, '') ?? '';
  // RFC 6008 requires at least eight characters, or the entire signature if shorter.
  const minimumPrefixLength = 8;
  const domain = tags.get('d')?.toLowerCase();
  const identity = (tags.get('i') ?? `@${domain ?? ''}`).toLowerCase();
  const signedHeaders = new Set(
    (tags.get('h') ?? '')
      .toLowerCase()
      .split(':')
      .map((name) => name.trim()),
  );

  return (
    prefix.length >= Math.min(minimumPrefixLength, signature.length) &&
    domain === EXPORT_EMAIL.dmarcFromDomain &&
    identity === EXPORT_EMAIL.dkimIdentity &&
    tags.get('s')?.toLowerCase() === selector.toLowerCase() &&
    ['from', 'to', 'subject', 'x-feedback-id'].every((name) => signedHeaders.has(name))
  );
}

/** Folded DKIM tag/value pairs; duplicate tags are ambiguous and rejected. */
function dkimTags(value: string): Map<string, string> | undefined {
  const tags = new Map<string, string>();

  for (const field of value.split(';')) {
    if (field.trim() === '') {
      continue;
    }

    const separator = field.indexOf('=');
    const name = field.slice(0, separator).trim().toLowerCase();

    if (separator < 1 || !/^[a-z][\da-z_]*$/.test(name) || tags.has(name)) {
      return undefined;
    }

    tags.set(name, field.slice(separator + 1).trim());
  }

  return tags;
}

function headerValues(headers: readonly { name: string; value: string }[], name: string): string[] {
  const wanted = name.toLowerCase();

  return headers.filter((header) => header.name.toLowerCase() === wanted).map(({ value }) => value);
}

/** A single mailbox address, lowercased; undefined for zero, several or malformed. */
function singleAddress(values: readonly string[]): string | undefined {
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

function hrefOf(attributes: string): string | undefined {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];

  return raw === undefined ? undefined : decodeEntities(raw.trim());
}

/** Only `https://mg.mail.notion.com/c/<token>`: no other host, port, credentials or path. */
function isAllowedLink(href: string): boolean {
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

/** Visible text: no style or script blocks, no tags, entities decoded, whitespace collapsed. */
function textOf(html: string): string {
  const withoutBlocks = html.replaceAll(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ');

  return decodeEntities(withoutBlocks.replaceAll(/<[^>]*>/g, ' '))
    .replaceAll(/\s+/g, ' ')
    .trim();
}

const namedEntities: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/** U+10FFFF, the largest Unicode code point. */
const MAX_CODE_POINT = 1_114_111;

function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const codePoint =
        name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= MAX_CODE_POINT
        ? String.fromCodePoint(codePoint)
        : entity;
    }

    return namedEntities[name.toLowerCase()] ?? entity;
  });
}
