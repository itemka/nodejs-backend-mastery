import { describe, expect, it } from 'vitest';

import {
  checkExportEmail,
  exportEmailQuery,
  extractDownloadLink,
  parseAuthenticationResults,
} from '../../../src/adapters/gmail/export-email-parser.js';
import {
  loadEmailFixture,
  messageWith,
  toGmailMessage,
  withHeader,
} from '../../support/gmail-fixtures.js';

const fixture = loadEmailFixture('export-ready');
const receivedAt = Number(fixture.internalDate);
const fresh = {
  excludeIds: [],
  expectedRecipient: 'user@example.com',
  notBefore: new Date(receivedAt - 5 * 60_000),
};
const notionSignature =
  'v=1; a=rsa-sha256; d=mail.notion.com; s=pic; h=From:To:Subject:X-Feedback-Id; b=fixture';

const gmailVerdict = (results: string) => `mx.google.com;\r\n       ${results}`;
const notionDkim = 'dkim=pass header.i=@mail.notion.com header.s=pic header.b=fixture';
const notionDmarc = 'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=mail.notion.com';

const withHtml = (html: string) => messageWith(fixture, { html });

describe('exportEmailQuery', () => {
  it('searches by sender and subject after the bound, in epoch seconds', () => {
    expect(exportEmailQuery(new Date('2026-10-01T20:40:00.900Z'))).toBe(
      'from:notify@mail.notion.com subject:"Your workspace export is ready" after:1790887200',
    );
  });
});

describe('checkExportEmail', () => {
  it('trusts the Phase 0 export email', () => {
    expect(checkExportEmail(toGmailMessage(fixture), fresh)).toBeUndefined();
  });

  it('rejects an email that is already consumed', () => {
    expect(checkExportEmail(toGmailMessage(fixture), { ...fresh, excludeIds: [fixture.id] })).toBe(
      'consumed',
    );
  });

  it('rejects an email received before the search bound', () => {
    expect(
      checkExportEmail(toGmailMessage(fixture), {
        ...fresh,
        excludeIds: [],
        notBefore: new Date(receivedAt + 1),
      }),
    ).toBe('stale');
  });

  it.each([
    ['another sender', 'Notion Team <team@mail.notion.com>'],
    ['a look-alike domain', 'Notion Team <notify@mail.notion.com.evil.example>'],
    ['the address only in the display name', '"notify@mail.notion.com" <attacker@evil.example>'],
    ['two addresses', 'notify@mail.notion.com, attacker@evil.example'],
    ['no address', 'Notion Team'],
  ])('rejects %s in From', (_case, from) => {
    expect(checkExportEmail(toGmailMessage(withHeader(fixture, 'From', from)), fresh)).toBe(
      'sender',
    );
  });

  it('accepts a bare sender address in any case', () => {
    expect(
      checkExportEmail(
        toGmailMessage(withHeader(fixture, 'From', 'Notify@Mail.Notion.com')),
        fresh,
      ),
    ).toBeUndefined();
  });

  it('rejects two From headers', () => {
    const twoFrom = withHeader(
      fixture,
      'From',
      'Notion Team <notify@mail.notion.com>',
      'Notion Team <notify@mail.notion.com>',
    );

    expect(checkExportEmail(toGmailMessage(twoFrom), fresh)).toBe('sender');
  });

  it.each([
    ['a replay to this mailbox', ['attacker@example.com']],
    ['a recipient hidden in the display name', ['"user@example.com" <attacker@example.com>']],
    ['multiple recipients', ['user@example.com, attacker@example.com']],
    ['duplicate To headers', ['user@example.com', 'attacker@example.com']],
    ['a missing To header', []],
  ])('rejects %s despite a passing Gmail verdict', (_case, recipients) => {
    const replay = withHeader(fixture, 'To', ...recipients);

    expect(checkExportEmail(toGmailMessage(replay), fresh)).toBe('recipient');
  });

  it('accepts a single recipient with a display name and mixed case', () => {
    const addressed = withHeader(fixture, 'To', 'Backup User <User@Example.Com>');

    expect(checkExportEmail(toGmailMessage(addressed), fresh)).toBeUndefined();
  });

  it.each(['From', 'To', 'Subject', 'X-Feedback-Id'])(
    'rejects a verified signature that does not cover %s',
    (header) => {
      const signedHeaders = ['From', 'To', 'Subject', 'X-Feedback-Id']
        .filter((name) => name !== header)
        .join(':');
      const signature = notionSignature.replace('From:To:Subject:X-Feedback-Id', signedHeaders);

      expect(
        checkExportEmail(toGmailMessage(withHeader(fixture, 'DKIM-Signature', signature)), fresh),
      ).toBe('authentication');
    },
  );

  it.each([
    ['no signature', []],
    ['another selector', [notionSignature.replace('s=pic', 's=other')]],
    ['another signature value', [notionSignature.replace('b=fixture', 'b=other')]],
    ['another signing domain', [notionSignature.replace('d=mail.notion.com', 'd=evil.example')]],
    ['duplicate tags', [`${notionSignature}; h=From:To`]],
    ['an ambiguous signature prefix', [notionSignature, `${notionSignature}extra`]],
  ])('rejects %s even when Gmail reports a Notion DKIM pass', (_case, signatures) => {
    expect(
      checkExportEmail(toGmailMessage(withHeader(fixture, 'DKIM-Signature', ...signatures)), fresh),
    ).toBe('authentication');
  });

  it('matches a folded signature using Gmail’s case-sensitive b prefix', () => {
    const signed = withHeader(
      withHeader(
        fixture,
        'DKIM-Signature',
        notionSignature.replace('b=fixture', 'b=fixtureA\r\n BCDE'),
      ),
      'Authentication-Results',
      gmailVerdict(
        `${notionDkim.replace('header.b=fixture', 'header.b=fixtureA')}; ${notionDmarc}`,
      ),
    );

    expect(checkExportEmail(toGmailMessage(signed), fresh)).toBeUndefined();
  });

  it('does not take recipient coverage from a different, unverified signature', () => {
    const signed = withHeader(
      fixture,
      'DKIM-Signature',
      notionSignature.replace('From:To:Subject', 'From:Subject'),
      notionSignature.replace('b=fixture', 'b=forged'),
    );

    expect(checkExportEmail(toGmailMessage(signed), fresh)).toBe('authentication');
  });

  it.each([
    ['no signature prefix', notionDkim.replace(' header.b=fixture', '')],
    ['no selector', notionDkim.replace(' header.s=pic', '')],
    ['different prefix case', notionDkim.replace('header.b=fixture', 'header.b=FIXTURE')],
  ])('rejects Gmail’s verdict with %s', (_case, dkim) => {
    const signed = withHeader(
      fixture,
      'Authentication-Results',
      gmailVerdict(`${dkim}; ${notionDmarc}`),
    );

    expect(checkExportEmail(toGmailMessage(signed), fresh)).toBe('authentication');
  });

  it('rejects another subject', () => {
    expect(
      checkExportEmail(
        toGmailMessage(withHeader(fixture, 'Subject', 'Your page export is ready')),
        fresh,
      ),
    ).toBe('subject');
  });

  it.each([
    [
      'another subtype',
      'notify@mail.notion.com:email_type=sendNotification-email_subtype=export-failed:0:mailgun',
    ],
    ['another sender', 'notify@evil.example:email_type=x-email_subtype=export-completed:0:mailgun'],
    [
      'the subtype outside the type field',
      'notify@mail.notion.com:email_type=x:email_subtype=export-completed',
    ],
  ])('rejects %s in X-Feedback-Id', (_case, feedbackId) => {
    expect(
      checkExportEmail(toGmailMessage(withHeader(fixture, 'X-Feedback-Id', feedbackId)), fresh),
    ).toBe('type');
  });

  it('rejects an email without X-Feedback-Id', () => {
    expect(checkExportEmail(toGmailMessage(withHeader(fixture, 'X-Feedback-Id')), fresh)).toBe(
      'type',
    );
  });

  it.each([
    ['no DKIM pass', gmailVerdict(`dkim=fail header.i=@mail.notion.com; ${notionDmarc}`)],
    [
      'a DKIM pass for Mailgun only',
      gmailVerdict(`dkim=pass header.i=@mailgun.org; ${notionDmarc}`),
    ],
    [
      'a DKIM pass for a subdomain',
      gmailVerdict(`dkim=pass header.i=@evil.mail.notion.com; ${notionDmarc}`),
    ],
    ['no DMARC pass', gmailVerdict(`${notionDkim}; dmarc=fail header.from=mail.notion.com`)],
    [
      'a DMARC pass for another domain',
      gmailVerdict(`${notionDkim}; dmarc=pass header.from=evil.example`),
    ],
    ['another authserv-id', `mx.evil.example; ${notionDkim}; ${notionDmarc}`],
  ])("rejects Gmail's verdict with %s", (_case, verdict) => {
    expect(
      checkExportEmail(
        toGmailMessage(withHeader(fixture, 'Authentication-Results', verdict)),
        fresh,
      ),
    ).toBe('authentication');
  });

  it('rejects an email without Authentication-Results', () => {
    expect(
      checkExportEmail(toGmailMessage(withHeader(fixture, 'Authentication-Results')), fresh),
    ).toBe('authentication');
  });

  it("ignores a forged pass below Gmail's own verdict", () => {
    const forged = loadEmailFixture('forged-authentication-results');

    expect(
      checkExportEmail(toGmailMessage(forged), {
        ...fresh,
        excludeIds: [],
        notBefore: new Date(Number(forged.internalDate) - 60_000),
      }),
    ).toBe('authentication');
  });

  it('ignores ARC-Authentication-Results', () => {
    const arcOnly = withHeader(fixture, 'Authentication-Results');

    expect(checkExportEmail(toGmailMessage(arcOnly), fresh)).toBe('authentication');
  });
});

describe('parseAuthenticationResults', () => {
  it('parses methods, results and properties, and drops comments', () => {
    const { authservId, results } = parseAuthenticationResults(
      'MX.Google.com 1; DKIM=Pass (good (nested) signature) header.i=@mail.notion.com header.s=pic; spf=pass (google.com: domain of x designates y) smtp.mailfrom="bounce+a@mail.notion.com"',
    );

    expect(authservId).toBe('mx.google.com');
    expect(results).toEqual([
      {
        method: 'dkim',
        properties: { 'header.i': '@mail.notion.com', 'header.s': 'pic' },
        result: 'pass',
      },
      {
        method: 'spf',
        properties: { 'smtp.mailfrom': 'bounce+a@mail.notion.com' },
        result: 'pass',
      },
    ]);
  });

  it('skips sections without a method result', () => {
    expect(parseAuthenticationResults('mx.google.com; none').results).toEqual([]);
  });
});

describe('extractDownloadLink', () => {
  it('returns the single "here" link of the Phase 0 email', () => {
    expect(extractDownloadLink(toGmailMessage(fixture))).toEqual({
      link: 'https://mg.mail.notion.com/c/fixture-download-link-not-real',
      ok: true,
    });
  });

  it('finds the HTML part inside a multipart message and decodes entities in the link', () => {
    const html =
      '<p>Click <a href="https://mg.mail.notion.com/c/a?x=1&amp;y=2"><b>Here</b></a> to download the export.</p>';
    const message = toGmailMessage(fixture);

    message.payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { body: { data: Buffer.from('plain text').toString('base64url') }, mimeType: 'text/plain' },
        { body: { data: Buffer.from(html).toString('base64url') }, mimeType: 'text/html' },
      ],
    };

    expect(extractDownloadLink(message)).toEqual({
      link: 'https://mg.mail.notion.com/c/a?x=1&y=2',
      ok: true,
    });
  });

  it('fails without an HTML part', () => {
    const message = toGmailMessage(fixture);

    message.payload = { body: { data: 'cGxhaW4' }, mimeType: 'text/plain' };

    expect(extractDownloadLink(message)).toEqual({ ok: false, problem: 'html_missing' });
  });

  it('fails when the template no longer says "to download the export"', () => {
    expect(
      extractDownloadLink(
        withHtml('<p>Click <a href="https://mg.mail.notion.com/c/x">here</a></p>'),
      ),
    ).toEqual({ ok: false, problem: 'sentence_missing' });
  });

  it.each([
    [
      'no "here" link',
      '<p>Use <a href="https://mg.mail.notion.com/c/x">this link</a> to download the export.</p>',
    ],
    [
      'two "here" links',
      '<p>Click <a href="https://mg.mail.notion.com/c/x">here</a> to download the export, or <a href="https://mg.mail.notion.com/c/y">here</a>.</p>',
    ],
  ])('fails with %s', (_case, html) => {
    expect(extractDownloadLink(withHtml(html))).toEqual({ ok: false, problem: 'link_count' });
  });

  it.each([
    ['another host', 'https://evil.example/c/x'],
    ['a look-alike host', 'https://mg.mail.notion.com.evil.example/c/x'],
    ['plain http', 'http://mg.mail.notion.com/c/x'],
    ['a port', 'https://mg.mail.notion.com:8443/c/x'],
    ['credentials', 'https://user@mg.mail.notion.com/c/x'],
    ['another path', 'https://mg.mail.notion.com/o/x'],
    ['an empty token', 'https://mg.mail.notion.com/c/'],
    ['a direct file link', 'https://file.notion.com/f/t/x/Export.zip'],
    ['no URL', 'javascript:alert(1)'],
  ])('fails for %s', (_case, href) => {
    expect(
      extractDownloadLink(
        withHtml(`<p>Click <a href="${href}">here</a> to download the export.</p>`),
      ),
    ).toEqual({ ok: false, problem: 'link_invalid' });
  });
});
