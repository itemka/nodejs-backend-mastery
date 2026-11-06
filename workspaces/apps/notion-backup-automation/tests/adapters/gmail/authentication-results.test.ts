import { describe, expect, it } from 'vitest';

import { parseAuthenticationResults } from '../../../src/adapters/gmail/authentication-results.js';

describe('parseAuthenticationResults', () => {
  it('parses methods, results and properties, and drops comments', () => {
    expect(
      parseAuthenticationResults(
        'MX.Google.com 1; DKIM=Pass (good (nested) signature) header.i=@mail.notion.com header.s=pic; spf=pass (google.com: domain of x designates y) smtp.mailfrom="bounce+a@mail.notion.com"',
      ),
    ).toEqual({
      authservId: 'mx.google.com',
      results: [
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
      ],
    });
  });

  it('skips a "none" section', () => {
    expect(parseAuthenticationResults('mx.google.com; none')).toEqual({
      authservId: 'mx.google.com',
      results: [],
    });
  });

  it('keeps a quoted value whole, with its ";", "=", "(" and escaped quotes', () => {
    expect(
      parseAuthenticationResults(
        String.raw`mx.google.com; spf=pass smtp.mailfrom="a; dkim=pass (x) \"q\"@evil.example"; dmarc=fail header.from=mail.notion.com`,
      )?.results,
    ).toEqual([
      {
        method: 'spf',
        properties: { 'smtp.mailfrom': 'a; dkim=pass (x) "q"@evil.example' },
        result: 'pass',
      },
      { method: 'dmarc', properties: { 'header.from': 'mail.notion.com' }, result: 'fail' },
    ]);
  });

  it('reads a ";" or quote inside a comment, and an escaped ")", as comment text', () => {
    expect(
      parseAuthenticationResults(
        String.raw`mx.google.com; dmarc=fail (p=REJECT; "x \) ; dmarc=pass header.from=mail.notion.com (y)) header.from=mail.notion.com`,
      )?.results,
    ).toEqual([
      { method: 'dmarc', properties: { 'header.from': 'mail.notion.com' }, result: 'fail' },
    ]);
  });

  it('joins a quoted local part, its domain and an unquoted "=" into one value', () => {
    expect(
      parseAuthenticationResults(
        'mx.google.com; spf=pass smtp.mailfrom="a b"@x.example header.b=ab=c; DMARC/1=Pass',
      )?.results,
    ).toEqual([
      {
        method: 'spf',
        properties: { 'header.b': 'ab=c', 'smtp.mailfrom': 'a b@x.example' },
        result: 'pass',
      },
      { method: 'dmarc', properties: {}, result: 'pass' },
    ]);
  });

  it.each([
    ['an unterminated quoted string', 'mx.google.com; spf=pass smtp.mailfrom="a; dkim=pass'],
    ['an unterminated comment', 'mx.google.com; dkim=pass (a (b) header.i=@mail.notion.com'],
    ['a stray ")"', 'mx.google.com; dkim=pass header.i=@mail.notion.com)'],
    [String.raw`a stray "\"`, String.raw`mx.google.com; dkim=pass header.i=\@mail.notion.com`],
    ['a section without a result', 'mx.google.com; dkim header.i=@mail.notion.com'],
    ['a property without a value', 'mx.google.com; dkim=pass header.i= header.s=pic'],
    ['a quoted method', 'mx.google.com; "dkim"=pass'],
    [
      'a property repeated within one result',
      'mx.google.com; dkim=pass header.i=@evil.example header.i=@mail.notion.com',
    ],
    ['anything but a version after the authserv-id', 'mx.google.com dkim=pass; spf=pass'],
    ['no authserv-id', '; dkim=pass'],
  ])('rejects %s', (_case, value) => {
    expect(parseAuthenticationResults(value)).toBeUndefined();
  });
});
