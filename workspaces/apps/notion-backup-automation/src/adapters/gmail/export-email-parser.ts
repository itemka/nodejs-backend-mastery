import { DomUtils, ElementType, parseDocument } from 'htmlparser2';

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
 * Parses an `Authentication-Results` value (RFC 8601): `authserv-id [version]; method=result
 * ptype.property=value …; …`. Quoted strings are values, so a `;`, `=` or `(` inside one is
 * text. Comments may nest and are dropped. Method names (without a `/version`), results,
 * property names and the authserv-id are lowercased; a `none` section is skipped.
 *
 * Undefined when the value does not follow that grammar: an unterminated quoted string or
 * comment, a section that is not `method=result` followed by `name=value` pairs, or a property
 * repeated within one result.
 */
export function parseAuthenticationResults(value: string): AuthenticationResults | undefined {
  const [head = [], ...sections] = authResSections(value) ?? [];
  const [authservId, version, ...extra] = head;

  if (
    authservId === undefined ||
    authservId.kind === '=' ||
    (version !== undefined && (version.kind !== 'atom' || !/^\d+$/.test(version.text))) ||
    extra.length > 0
  ) {
    return undefined;
  }

  const results: AuthenticationResult[] = [];

  for (const section of sections) {
    const [only] = section;

    if (
      section.length === 0 ||
      (section.length === 1 && only?.kind === 'atom' && only.text.toLowerCase() === 'none')
    ) {
      continue;
    }

    const result = resultInfo(section);

    if (result === undefined) {
      return undefined;
    }

    results.push(result);
  }

  return { authservId: authservId.text.toLowerCase(), results };
}

/** A sender Gmail must have authenticated: its DKIM identity and its DMARC `From` domain. */
export interface TrustedSender {
  /** Gmail's own `Authentication-Results` must report a DKIM pass for this identity… */
  readonly dkimIdentity: string;
  /** …and a DMARC pass for this `From` domain, which also signs the email. */
  readonly dmarcFromDomain: string;
}

/**
 * Gmail's verdict, from its own (topmost) `Authentication-Results` value: every DKIM pass for the
 * sender's identity is bound to one verified signature that covers From, To, Subject and
 * X-Feedback-Id, and Gmail reported exactly one DMARC result, a pass for the sender's `From`
 * domain. A second DMARC result, passing or not, means part of the header is not Gmail's.
 */
export function isTrustedByGmail(
  value: string,
  signatures: readonly string[],
  sender: TrustedSender,
): boolean {
  const verdict = parseAuthenticationResults(value);

  if (verdict?.authservId !== EXPORT_EMAIL.gmailAuthservId) {
    return false;
  }

  const dkim = verdict.results.filter(
    ({ method, properties, result }) =>
      method === 'dkim' &&
      result === 'pass' &&
      properties['header.i']?.toLowerCase() === sender.dkimIdentity,
  );
  const dmarc = verdict.results.filter(({ method }) => method === 'dmarc');
  const [onlyDmarc] = dmarc;

  return (
    dkim.length > 0 &&
    dkim.every((result) => hasSignedTrustHeaders(result, signatures, sender)) &&
    dmarc.length === 1 &&
    onlyDmarc?.result === 'pass' &&
    onlyDmarc.properties['header.from']?.toLowerCase() === sender.dmarcFromDomain
  );
}

/** A token between two `;`; `spaced` when whitespace or a comment comes before it. */
type AuthResToken =
  | { readonly kind: '='; readonly spaced: boolean }
  | { readonly kind: 'atom' | 'quoted'; readonly spaced: boolean; readonly text: string };

/**
 * The `;`-separated sections of an `Authentication-Results` value, as atoms, quoted strings
 * (quoted pairs resolved, folding removed) and `=`. Undefined for an unterminated quoted string
 * or comment, or a `)` or `\` outside them.
 */
function authResSections(value: string): AuthResToken[][] | undefined {
  /** Anything but whitespace, a comment, a quoted string, `;`, `=` and `\`. */
  const atomPattern = /[^\s"();=\\]+/y;
  let section: AuthResToken[] = [];
  const sections = [section];
  let index = 0;
  let spaced = false;

  while (index < value.length) {
    atomPattern.lastIndex = index;
    const atom = atomPattern.exec(value)?.[0];
    const char = value.charAt(index);

    if (atom !== undefined) {
      section.push({ kind: 'atom', spaced, text: atom });
      index += atom.length;
      spaced = false;
      continue;
    }

    if (/\s/.test(char)) {
      index += 1;
      spaced = true;
      continue;
    }

    switch (char) {
      case '(': {
        const end = commentEnd(value, index);

        if (end === undefined) {
          return undefined;
        }

        index = end;
        spaced = true;
        break;
      }

      case '"': {
        const quoted = quotedString(value, index);

        if (quoted === undefined) {
          return undefined;
        }

        section.push({ kind: 'quoted', spaced, text: quoted.text });
        index = quoted.end;
        spaced = false;
        break;
      }

      case '=': {
        section.push({ kind: '=', spaced });
        index += 1;
        spaced = false;
        break;
      }

      case ';': {
        section = [];
        sections.push(section);
        index += 1;
        spaced = false;
        break;
      }

      default: {
        // A ")" or "\" outside a comment or quoted string.
        return undefined;
      }
    }
  }

  return sections;
}

/** The index after the comment opening at `start`; comments nest and hold quoted pairs. */
function commentEnd(value: string, start: number): number | undefined {
  let depth = 0;

  for (let index = start; index < value.length; index += 1) {
    switch (value.charAt(index)) {
      case '\\': {
        // A quoted pair: the next character is text.
        index += 1;
        break;
      }

      case '(': {
        depth += 1;
        break;
      }

      case ')': {
        depth -= 1;

        if (depth === 0) {
          return index + 1;
        }

        break;
      }

      default:
    }
  }

  return undefined;
}

/** The quoted string opening at `start`: its text and the index after its closing quote. */
function quotedString(value: string, start: number): { end: number; text: string } | undefined {
  let text = '';

  for (let index = start + 1; index < value.length; index += 1) {
    const char = value.charAt(index);

    if (char === '"') {
      return { end: index + 1, text };
    }

    if (char === '\\') {
      index += 1;

      if (index >= value.length) {
        return undefined;
      }

      text += value.charAt(index);
    } else if (char !== '\r' && char !== '\n') {
      text += char;
    }
  }

  return undefined;
}

/**
 * `method[/version]=result` followed by `name=value` pairs. A value starts right after its `=`
 * and runs until whitespace or a comment, so `"local part"@domain` and `a=b@domain` stay whole.
 */
function resultInfo(tokens: readonly AuthResToken[]): AuthenticationResult | undefined {
  const [method, equals, result] = tokens;

  if (method?.kind !== 'atom' || equals?.kind !== '=' || result?.kind !== 'atom') {
    return undefined;
  }

  const [name = ''] = method.text.toLowerCase().split('/');
  const properties: Record<string, string> = {};
  let index = 3;

  while (index < tokens.length) {
    const property = tokens[index];
    const separator = tokens[index + 1];
    const first = tokens[index + 2];

    if (
      property?.kind !== 'atom' ||
      separator?.kind !== '=' ||
      first === undefined ||
      first.kind === '=' ||
      first.spaced
    ) {
      return undefined;
    }

    const key = property.text.toLowerCase();
    let text = first.text;

    for (index += 3; index < tokens.length; index += 1) {
      const next = tokens[index];

      if (next === undefined || next.spaced) {
        break;
      }

      text += next.kind === '=' ? '=' : next.text;
    }

    if (Object.hasOwn(properties, key)) {
      return undefined;
    }

    properties[key] = text;
  }

  return name === '' ? undefined : { method: name, properties, result: result.text.toLowerCase() };
}

/** RFC 6008: header.b identifies the verified signature by a case-sensitive, unique prefix. */
function hasSignedTrustHeaders(
  result: AuthenticationResult,
  signatures: readonly string[],
  sender: TrustedSender,
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
    domain === sender.dmarcFromDomain &&
    identity === sender.dkimIdentity &&
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
