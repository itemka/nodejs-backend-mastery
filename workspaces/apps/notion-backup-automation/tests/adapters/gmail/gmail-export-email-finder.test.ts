import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { GmailApi } from '../../../src/adapters/gmail/gmail-api.js';
import { GmailExportEmailFinder } from '../../../src/adapters/gmail/gmail-export-email-finder.js';
import type { GmailMessage } from '../../../src/adapters/gmail/gmail-schemas.js';
import { GoogleApiClient } from '../../../src/adapters/google/google-api-client.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import { createLogger } from '../../../src/shared/logger.js';
import { FakeGoogle, googleError } from '../../support/fake-google.js';
import {
  loadEmailFixture,
  messageWith,
  toGmailMessage,
  withHeader,
} from '../../support/gmail-fixtures.js';

const MESSAGES_PATH = 'gmail.googleapis.com/gmail/v1/users/me/messages';
const LINK = 'https://mg.mail.notion.com/c/fixture-download-link-not-real';

const exportReady = loadEmailFixture('export-ready');
const forged = loadEmailFixture('forged-authentication-results');
const receivedAt = Number(exportReady.internalDate);
/** The export was requested 3 minutes before the email arrived. */
const requestedAfter = new Date(receivedAt - 3 * 60_000);

function setup(messages: readonly GmailMessage[]) {
  const google = new FakeGoogle()
    .on('GET', MESSAGES_PATH, () =>
      Response.json({ messages: messages.map(({ id }) => ({ id, threadId: id })) }),
    )
    .on('GET', `${MESSAGES_PATH}/*`, ({ url }) => {
      const message = messages.find(({ id }) => url.pathname.endsWith(`/${id}`));

      return message === undefined ? googleError(404, 'notFound') : Response.json(message);
    })
    .on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () =>
      Response.json({ emailAddress: 'user@example.com' }),
    );
  const lines: string[] = [];
  const api = new GoogleApiClient({
    fetch: google.fetch,
    service: 'gmail',
    sleep: () => Promise.resolve(),
    tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
  });
  const finder = new GmailExportEmailFinder({
    gmail: new GmailApi(api),
    logger: createLogger({
      level: 'debug',
      sink: (_level, line) => {
        lines.push(line);
      },
    }),
  });

  return { finder, google, lines };
}

const at = (offsetMs: number) => String(receivedAt + offsetMs);

describe('GmailExportEmailFinder.findReadyEmail', () => {
  it('finds the export email and searches from 10 minutes before the request', async () => {
    const { finder, google } = setup([toGmailMessage(exportReady)]);

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).resolves.toEqual({
      email: { messageId: exportReady.id, receivedAt: '2026-10-01T20:56:22.000Z' },
      status: 'found',
    });

    const [list, get] = google.requests;

    expect(list?.url.searchParams.get('q')).toBe(
      `from:notify@mail.notion.com subject:"Your workspace export is ready" after:${Math.floor(requestedAfter.getTime() / 1000) - 600}`,
    );
    expect(list?.headers.get('authorization')).toBe('Bearer fake-access-token');
    expect(get?.url.searchParams.get('format')).toBe('full');
  });

  it('returns the newest trusted email', async () => {
    const older = messageWith(exportReady, { id: 'older', internalDate: at(-60_000) });
    const newer = messageWith(exportReady, { id: 'newer', internalDate: at(60_000) });
    const { finder } = setup([older, newer]);

    const result = await finder.findReadyEmail({ excludeIds: [], requestedAfter });

    expect(result).toMatchObject({ email: { messageId: 'newer' }, status: 'found' });
  });

  it('skips a fresh replay addressed to another mailbox and finds this mailbox’s export', async () => {
    const replay = messageWith(withHeader(exportReady, 'To', 'attacker@example.com'), {
      id: 'replayed',
      internalDate: at(60_000),
    });
    const { finder, lines } = setup([replay, toGmailMessage(exportReady)]);

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).resolves.toMatchObject({
      email: { messageId: exportReady.id },
      status: 'found',
    });
    expect(lines.join('\n')).not.toMatch(/user@example.com|attacker@example.com/);
  });

  it('fails closed when the authenticated mailbox cannot be read', async () => {
    const { finder, google } = setup([toGmailMessage(exportReady)]);

    google.on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () => googleError(401));

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
    });
  });

  it('skips a message deleted after listing and examines the remaining candidates', async () => {
    const deleted = messageWith(exportReady, { id: 'deleted', internalDate: at(60_000) });
    const { finder, google } = setup([deleted, toGmailMessage(exportReady)]);

    google.on('GET', `${MESSAGES_PATH}/deleted`, () => googleError(404, 'notFound'));

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).resolves.toMatchObject({
      email: { messageId: exportReady.id },
      status: 'found',
    });
  });

  it('reports not found when every listed message has been deleted', async () => {
    const { finder, google } = setup([toGmailMessage(exportReady)]);

    google.on('GET', `${MESSAGES_PATH}/*`, () => googleError(404, 'notFound'));

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).resolves.toEqual({
      rejected: {},
      status: 'not_found',
    });
  });

  it.each([
    [401, 'GOOGLE_AUTH_REQUIRED'],
    [503, 'GMAIL_UNAVAILABLE'],
    [400, 'INTEGRATION_UNCLASSIFIED'],
  ])('propagates HTTP %s while reading a candidate', async (status, code) => {
    const { finder, google } = setup([toGmailMessage(exportReady)]);

    google.on('GET', `${MESSAGES_PATH}/*`, () => googleError(status));

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).rejects.toMatchObject({
      code,
    });
  });

  it('skips rejected emails, counting the reasons, and falls back to an older trusted one', async () => {
    const consumed = messageWith(exportReady, { id: 'consumed', internalDate: at(120_000) });
    const { finder } = setup([consumed, toGmailMessage(forged), toGmailMessage(exportReady)]);

    await expect(
      finder.findReadyEmail({ excludeIds: ['consumed'], requestedAfter }),
    ).resolves.toMatchObject({ email: { messageId: exportReady.id }, status: 'found' });
  });

  it('reports not found with the rejection counts', async () => {
    const stale = messageWith(exportReady, { id: 'stale', internalDate: at(-20 * 60_000) });
    const otherType = toGmailMessage({
      ...withHeader(
        exportReady,
        'X-Feedback-Id',
        'notify@mail.notion.com:email_type=sendNotification-email_subtype=export-failed:0:mailgun',
      ),
      id: 'other-type',
    });
    const { finder } = setup([stale, otherType, toGmailMessage(forged)]);

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).resolves.toEqual({
      rejected: { authentication: 1, stale: 1, type: 1 },
      status: 'not_found',
    });
  });

  it('reports not found when nothing matches the search', async () => {
    const { finder } = setup([]);

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).resolves.toEqual({
      rejected: {},
      status: 'not_found',
    });
  });

  it('fails with EMAIL_UNRECOGNIZED when the trusted email has no single allowed link', async () => {
    const changed = messageWith(exportReady, {
      html: '<p>Your export is ready. <a href="https://mg.mail.notion.com/c/x">Download</a></p>',
    });
    const { finder } = setup([changed]);

    const error = await finder
      .findReadyEmail({ excludeIds: [], requestedAfter })
      .catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({ code: 'EMAIL_UNRECOGNIZED' });
  });

  it('reports a Gmail outage as GMAIL_UNAVAILABLE after the in-call retries', async () => {
    const { finder, google } = setup([]);

    google.on('GET', MESSAGES_PATH, () => googleError(503));

    await expect(finder.findReadyEmail({ excludeIds: [], requestedAfter })).rejects.toMatchObject({
      code: 'GMAIL_UNAVAILABLE',
    });
    expect(google.requestsTo(MESSAGES_PATH)).toHaveLength(3);
  });

  it('logs IDs and verdicts, never the link, subject or body', async () => {
    const { finder, lines } = setup([toGmailMessage(forged), toGmailMessage(exportReady)]);

    await finder.findReadyEmail({ excludeIds: [], requestedAfter });

    const logs = lines.join('\n');

    expect(lines.length).toBeGreaterThan(0);
    expect(logs).toContain(exportReady.id);
    expect(logs).not.toMatch(/mg\.mail\.notion\.com|export is ready|download|fixture-/i);
  });
});

describe('GmailExportEmailFinder.getDownloadLink', () => {
  it('rechecks the recipient before revealing a download link', async () => {
    const { finder } = setup([
      toGmailMessage(withHeader(exportReady, 'To', 'attacker@example.com')),
    ]);

    await expect(finder.getDownloadLink(exportReady.id)).rejects.toMatchObject({
      code: 'EMAIL_UNRECOGNIZED',
      message: 'The export email failed a trust check (recipient)',
    });
  });

  it('re-reads the email and returns its link, hidden from serialization', async () => {
    const { finder } = setup([toGmailMessage(exportReady)]);

    const link = await finder.getDownloadLink(exportReady.id);

    expect(link.reveal()).toBe(LINK);
    expect(JSON.stringify({ link })).toBe('{"link":"[redacted]"}');
    expect(String(link)).toBe('[redacted]');
    expect(inspect(link)).not.toContain('mg.mail');
  });

  it('fails with EMAIL_UNRECOGNIZED when the email is gone', async () => {
    const { finder } = setup([]);

    await expect(finder.getDownloadLink('199a3c4d5e6f0000')).rejects.toMatchObject({
      code: 'EMAIL_UNRECOGNIZED',
      message: 'The export email no longer exists',
    });
  });

  it('fails with EMAIL_UNRECOGNIZED when the email no longer passes the trust checks', async () => {
    const { finder } = setup([toGmailMessage(forged)]);

    await expect(finder.getDownloadLink(forged.id)).rejects.toMatchObject({
      code: 'EMAIL_UNRECOGNIZED',
      message: 'The export email failed a trust check (authentication)',
    });
  });

  it('rejects a message ID that is not an ID before calling Gmail', async () => {
    const { finder, google } = setup([]);

    await expect(finder.getDownloadLink('../profile')).rejects.toThrow();
    expect(google.requests).toEqual([]);
  });
});
