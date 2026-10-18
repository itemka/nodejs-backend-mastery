import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { GmailMessage } from '../../src/adapters/gmail/gmail-schemas.js';

const fixtureSchema = z.object({
  headers: z.array(z.object({ name: z.string(), value: z.string() })),
  html: z.string(),
  id: z.string(),
  internalDate: z.string(),
});

export type EmailFixture = z.infer<typeof fixtureSchema>;

export type EmailFixtureName = 'export-ready' | 'forged-authentication-results';

export function loadEmailFixture(name: EmailFixtureName): EmailFixture {
  const file = path.resolve(import.meta.dirname, '../fixtures/emails', `${name}.json`);

  return fixtureSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** The Gmail API shape: one `text/html` part, body base64url-encoded. */
export function toGmailMessage(fixture: EmailFixture): GmailMessage {
  return {
    id: fixture.id,
    internalDate: fixture.internalDate,
    payload: {
      body: { data: Buffer.from(fixture.html, 'utf8').toString('base64url') },
      headers: fixture.headers,
      mimeType: 'text/html',
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
