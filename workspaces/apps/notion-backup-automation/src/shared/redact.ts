/** Replaces any value that must never reach a log line, an event or a tool result. */
export const REDACTED = '[redacted]';

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

/**
 * Field names whose string or object values are always replaced, matched after lowercasing and
 * removing `_` and `-`. Credentials, the Notion session, and email or ZIP content.
 * Booleans and numbers under these names (`tokenOk`, `cookieCount`) are kept.
 */
const sensitiveKeyPattern =
  /token|secret|password|passwd|cookie|authorization|signature|signingkey|apikey|encryptionkey|privatekey|storagestate|credential|subject|body|html|snippet|entryname/;

/**
 * Hosts whose URL paths carry a secret: Mailgun tracking tokens, Notion's signed export files,
 * and the Telegram Bot API, whose paths start with the bot token.
 */
const secretPathHosts = new Set(['api.telegram.org', 'file.notion.com', 'mg.mail.notion.com']);

const urlPattern = /\bhttps?:\/\/[^\s"'<>`]+/gi;

const secretPatterns: readonly (readonly [RegExp, string])[] = [
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`],
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, REDACTED],
  [/\bya29\.[\w.-]+/g, REDACTED],
  [/\b1\/\/[\w-]{20,}/g, REDACTED],
  // A Telegram bot token, `<bot id>:<secret>`.
  [/\b\d{5,20}:[\w-]{30,}/g, REDACTED],
  [/\b(token_v2|file_token|notion_user_id|notion_browser_id)=[^;\s]+/g, `$1=${REDACTED}`],
  [/\b(\w*(?:token|secret|password|signature|key))=[^\s&;]+/gi, `$1=${REDACTED}`],
];

export function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key.toLowerCase().replaceAll(/[_-]/g, ''));
}

/**
 * Removes secrets from free text: URL queries and fragments, URL credentials, secret URL paths,
 * bearer tokens, JWTs, Google tokens and Notion cookies. The output contains no `?` from a URL.
 */
export function redactString(text: string): string {
  let result = text.replaceAll(urlPattern, redactUrl);

  for (const [pattern, replacement] of secretPatterns) {
    result = result.replaceAll(pattern, replacement);
  }

  return result;
}

/**
 * Returns a JSON-safe copy of `value` with sensitive fields and secret-looking text replaced.
 * Every log line goes through it.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new Set());
}

function redactUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return REDACTED;
  }

  if (secretPathHosts.has(url.hostname)) {
    return `${url.origin}/${REDACTED}`;
  }

  const credentials = url.username !== '' || url.password !== '';
  const base = credentials ? raw.replace(/\/\/[^@/]*@/, `//${REDACTED}@`) : raw;
  const queryStart = base.search(/[?#]/);

  return queryStart === -1 ? base : `${base.slice(0, queryStart)}${REDACTED}`;
}

function redactPrimitive(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
}

function redactValue(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return redactPrimitive(value);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }

  if (value instanceof URL) {
    return redactString(value.href);
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value.byteLength} bytes]`;
  }

  if (depth >= MAX_DEPTH) {
    return '[truncated]';
  }

  if (ancestors.has(value)) {
    return '[circular]';
  }

  ancestors.add(value);

  try {
    if (value instanceof Error) {
      return redactError(value, depth, ancestors);
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, depth + 1, ancestors));
    }

    return redactEntries(Object.entries(value), depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function redactEntries(
  entries: [string, unknown][],
  depth: number,
  ancestors: Set<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, item] of entries) {
    const hidesContent = typeof item === 'string' || (typeof item === 'object' && item !== null);

    result[key] =
      isSensitiveKey(key) && hidesContent ? REDACTED : redactValue(item, depth + 1, ancestors);
  }

  return result;
}

/** Only the name, message, code, status, stack and cause: other properties may carry request data. */
function redactError(error: Error, depth: number, ancestors: Set<object>): Record<string, unknown> {
  const { cause, code, status } = error as Error & { code?: unknown; status?: unknown };
  const entries: [string, unknown][] = [
    ['name', error.name],
    ['message', error.message],
  ];

  if (typeof code === 'string' || typeof code === 'number') {
    entries.push(['code', code]);
  }

  if (typeof status === 'number') {
    entries.push(['status', status]);
  }

  if (error.stack !== undefined) {
    entries.push(['stack', error.stack]);
  }

  if (cause !== undefined) {
    entries.push(['cause', cause]);
  }

  return redactEntries(entries, depth, ancestors);
}
