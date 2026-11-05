import { describe, expect, it } from 'vitest';

import {
  checkLoginEmail,
  extractLoginCode,
  loginEmailQuery,
} from '../../../src/adapters/gmail/login-email-parser.js';
import {
  loadEmailFixture,
  messageWith,
  toGmailMessage,
  withHeader,
} from '../../support/gmail-fixtures.js';

/* The S7 login email with a made-up code (`Qx7mKp`); see tests/fixtures/emails/README.md. */
const fixture = loadEmailFixture('notion-login-code');
const receivedAt = Number(fixture.internalDate);
const fresh = { expectedRecipient: 'user@example.com', notBefore: new Date(receivedAt - 30_000) };

const check = (message = toGmailMessage(fixture)) => checkLoginEmail(message, fresh);

const code = (overrides: Parameters<typeof messageWith>[1]) => {
  const result = extractLoginCode(messageWith(fixture, overrides));

  return result.ok ? result.code.reveal() : result.problem;
};

describe('loginEmailQuery', () => {
  it('searches by sender and subject after the bound, in epoch seconds', () => {
    expect(loginEmailQuery(new Date('2026-11-05T15:03:00.900Z'))).toBe(
      'from:notify@updates.notion.com subject:"Your temporary Notion login code" after:1793890980',
    );
  });
});

describe('checkLoginEmail', () => {
  it('trusts the S7 email: sender, recipient, subject, type and Gmail’s verdict', () => {
    expect(check()).toBeUndefined();
  });

  it('accepts the two type fields in either order, as S7 saw them', () => {
    const swapped = withHeader(
      fixture,
      'X-Feedback-Id',
      'notify@updates.notion.com:email_subtype=existingUser-email_type=sendTemporaryPassword:0:mailgun',
    );

    expect(check(toGmailMessage(swapped))).toBeUndefined();
  });

  it('refuses an email received before the request', () => {
    expect(
      checkLoginEmail(toGmailMessage(fixture), {
        ...fresh,
        notBefore: new Date(receivedAt + 1000),
      }),
    ).toBe('stale');
  });

  it('refuses the export sender, another recipient and another subject', () => {
    expect(
      check(toGmailMessage(withHeader(fixture, 'From', 'Notion <notify@mail.notion.com>'))),
    ).toBe('sender');
    expect(check(toGmailMessage(withHeader(fixture, 'To', 'someone@example.com')))).toBe(
      'recipient',
    );
    expect(
      check(toGmailMessage(withHeader(fixture, 'To', 'user@example.com, other@example.com'))),
    ).toBe('recipient');
    expect(
      check(toGmailMessage(withHeader(fixture, 'Subject', 'Your temporary Notion login code!'))),
    ).toBe('subject');
  });

  it('refuses the "new device" notice that follows every login', () => {
    const notice = withHeader(
      withHeader(fixture, 'Subject', 'Your temporary Notion login code'),
      'X-Feedback-Id',
      'notify@updates.notion.com:email_type=newDeviceLoginEmail:0:mailgun',
    );

    expect(check(toGmailMessage(notice))).toBe('type');
  });

  it('refuses a type marker from another sender, a sign-up’s, or a missing one', () => {
    const otherSender = withHeader(
      fixture,
      'X-Feedback-Id',
      'notify@example.com:email_type=sendTemporaryPassword-email_subtype=existingUser:0:mailgun',
    );

    const signUp = withHeader(
      fixture,
      'X-Feedback-Id',
      'notify@updates.notion.com:email_type=sendTemporaryPassword-email_subtype=newUser:0:mailgun',
    );

    expect(check(toGmailMessage(otherSender))).toBe('type');
    expect(check(toGmailMessage(signUp))).toBe('type');
    expect(check(toGmailMessage(withHeader(fixture, 'X-Feedback-Id')))).toBe('type');
  });

  it('trusts only Gmail’s own topmost verdict', () => {
    const forged = withHeader(
      fixture,
      'Authentication-Results',
      'mx.google.com;\r\n       dkim=fail header.i=@updates.notion.com header.s=smtp header.b="fixtureU";\r\n       dmarc=fail header.from=updates.notion.com',
      'mx.google.com; dkim=pass header.i=@updates.notion.com header.s=smtp header.b="fixtureU"; dmarc=pass header.from=updates.notion.com',
    );

    expect(check(toGmailMessage(forged))).toBe('authentication');
  });

  it('refuses a pass for Mailgun alone, or a signature that does not cover the type', () => {
    const mailgunOnly = withHeader(
      fixture,
      'Authentication-Results',
      'mx.google.com; dkim=pass header.i=@mailgun.org header.s=mg header.b=fixtureM; dmarc=pass header.from=updates.notion.com',
    );
    const unsignedType = withHeader(
      fixture,
      'DKIM-Signature',
      'a=rsa-sha256; v=1; d=updates.notion.com; s=smtp; h=Message-Id: To: From: Subject; bh=fixture; b=fixtureUpdatesSignatureNotReal',
    );

    expect(check(toGmailMessage(mailgunOnly))).toBe('authentication');
    expect(check(toGmailMessage(unsignedType))).toBe('authentication');
  });
});

describe('extractLoginCode', () => {
  it('takes the code that stands alone in the text and in the HTML', () => {
    expect(code({})).toBe('Qx7mKp');
  });

  it('never reads the magic link, which carries the code too', () => {
    expect(code({ html: fixture.html.replaceAll('>Qx7mKp<', '><') })).toBe('Qx7mKp');
    expect(code({ html: fixture.html.replaceAll('>Qx7mKp<', '><'), text: '' })).toBe('none');
  });

  it('takes a letters-only code over a plain word found in both parts (S7)', () => {
    expect(
      code({
        html: '<p>Notion</p><pre>QwRtzK</pre>',
        text: 'Notion\nQwRtzK\n',
      }),
    ).toBe('QwRtzK');
  });

  it('takes a code shown in only one part', () => {
    expect(code({ html: '<p>Your code</p><pre>A1b2C3</pre>', text: 'See the HTML version.' })).toBe(
      'A1b2C3',
    );
  });

  it('reports two unrelated codes as ambiguous, and none as none', () => {
    expect(code({ html: '<pre>A1b2C3</pre><pre>D4e5F6</pre>', text: '' })).toBe('ambiguous');
    expect(code({ html: '<p>Login to Notion</p>', text: 'Never share this code.' })).toBe('none');
  });

  it.each([
    ['the title', '<head><title>Zz9Yy8</title></head>'],
    ['a style', '<head><style>Zz9Yy8</style></head>'],
    ['a script', '<body><script>Zz9Yy8</script></body>'],
    ['the head', '<head><meta name="x"><base href="/">Zz9Yy8</head>'],
    [
      'an inline display: none',
      '<body><span style="color: red; display:none">Zz9Yy8</span></body>',
    ],
    ['an inline visibility: hidden', '<body><div style="visibility: hidden">Zz9Yy8</div></body>'],
  ])('never takes a code hidden in %s, even through an ancestor', (_case, part) => {
    expect(
      code({ html: `<html>${part}<body><p>Login to Notion</p></body></html>`, text: '' }),
    ).toBe('none');
  });

  it('ignores text in the title, styles and scripts', () => {
    expect(
      code({
        html: '<html><head><title>Zz9Yy8</title><style>Ab12Cd</style><script>Ef34Gh</script></head><body><pre>Qx7mKp</pre></body></html>',
        text: '',
      }),
    ).toBe('Qx7mKp');
  });
});
