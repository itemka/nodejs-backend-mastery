import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { GmailMessage } from '../../src/adapters/gmail/gmail-schemas.js';

const fixtureSchema = z.object({
  headers: z.array(z.object({ name: z.string(), value: z.string() })),
  html: z.string(),
  id: z.string(),
  internalDate: z.string(),
  /** A `text/plain` part beside the HTML, as in the login-code email. */
  text: z.string().optional(),
});

export type EmailFixture = z.infer<typeof fixtureSchema>;

export type EmailFixtureName =
  | 'export-ready'
  | 'forged-authentication-results'
  | 'notion-login-code';

export function loadEmailFixture(name: EmailFixtureName): EmailFixture {
  const file = path.resolve(import.meta.dirname, '../fixtures/emails', `${name}.json`);

  return fixtureSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

/**
 * The Gmail API shape, bodies base64url-encoded: one `text/html` part, or with `text` a
 * `multipart/alternative` of the plain text and the HTML.
 */
export function toGmailMessage(fixture: EmailFixture): GmailMessage {
  const { headers, html, id, internalDate, text } = fixture;

  if (text === undefined) {
    return {
      id,
      internalDate,
      payload: { body: { data: encode(html) }, headers, mimeType: 'text/html' },
    };
  }

  return {
    id,
    internalDate,
    payload: {
      headers,
      mimeType: 'multipart/alternative',
      parts: [
        { body: { data: encode(text) }, mimeType: 'text/plain' },
        { body: { data: encode(html) }, mimeType: 'text/html' },
      ],
    },
  };
}

/** Replaces every header named `name` (case-insensitive) with `values`, at the first one's place. */
export function withHeader(
  fixture: EmailFixture,
  name: string,
  ...values: readonly string[]
): EmailFixture {
  const wanted = name.toLowerCase();
  const index = fixture.headers.findIndex((header) => header.name.toLowerCase() === wanted);
  const others = fixture.headers.filter((header) => header.name.toLowerCase() !== wanted);
  const replacement = values.map((value) => ({ name, value }));
  const at = index === -1 ? others.length : index;

  return { ...fixture, headers: [...others.slice(0, at), ...replacement, ...others.slice(at)] };
}

export function messageWith(fixture: EmailFixture, overrides: Partial<EmailFixture>): GmailMessage {
  return toGmailMessage({ ...fixture, ...overrides });
}
