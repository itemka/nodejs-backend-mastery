import { describe, expect, it } from 'vitest';

import { REDACTED, redact, redactString } from '../../src/shared/redact.js';

// Secret-shaped strings are assembled at run time so that secret scanners do not flag the file.
const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzZWNyZXQifQ', 'c2lnbmF0dXJlLXZhbHVl'].join('.');
const googleAccessToken = ['ya29', 'a0AbCdEfGhIjKlMnOpQrStUv'].join('.');
const googleRefreshToken = `1//${'0gAbCdEfGhIjKlMnOpQrStUvWxYz'}`;
const telegramBotToken = ['8123456789', `AAH${'x'.repeat(32)}`].join(':');

/** The Step 28 log check: no URL with a query may remain. */
const urlWithQuery = /https?:\/\/[^" ]*\?/;

describe('redactString', () => {
  it('drops URL queries and fragments, keeping the origin and path', () => {
    const text = 'GET https://api.example.com/v1/items?id=1&token=abc#frag done';

    expect(redactString(text)).toBe(`GET https://api.example.com/v1/items${REDACTED} done`);
    expect(redactString(text)).not.toMatch(urlWithQuery);
  });

  it('hides the whole path of Mailgun tracking links and Notion export files', () => {
    expect(redactString('see https://mg.mail.notion.com/c/eJx1kTtv2zAQhL')).toBe(
      `see https://mg.mail.notion.com/${REDACTED}`,
    );
    expect(
      redactString('https://file.notion.com/f/t/0a1b/Export-0a1b.zip?table=user_export&id=1'),
    ).toBe(`https://file.notion.com/${REDACTED}`);
  });

  it('hides the whole path of Telegram Bot API calls, which start with the token', () => {
    expect(redactString(`POST https://api.telegram.org/bot${telegramBotToken}/sendMessage`)).toBe(
      `POST https://api.telegram.org/${REDACTED}`,
    );
  });

  it('hides URL credentials', () => {
    expect(redactString('redis https://default:pa55word@eu1.example.io/x')).toBe(
      `redis https://${REDACTED}@eu1.example.io/x`,
    );
  });

  it('keeps URLs without secrets unchanged', () => {
    expect(redactString('https://app.notion.com/login')).toBe('https://app.notion.com/login');
  });

  it.each([
    [
      'a bearer token',
      'Authorization: Bearer abc.DEF-123/xyz=',
      `Authorization: Bearer ${REDACTED}`,
    ],
    ['a JWT', `jwt ${jwt} end`, `jwt ${REDACTED} end`],
    ['a Google access token', `token ${googleAccessToken}`, `token ${REDACTED}`],
    ['a Google refresh token', `got ${googleRefreshToken}`, `got ${REDACTED}`],
    ['a Telegram bot token', `bot ${telegramBotToken} end`, `bot ${REDACTED} end`],
    [
      'Notion cookies',
      'cookie: token_v2=v02%3Auser; file_token=abc123; other=1',
      `cookie: token_v2=${REDACTED}; file_token=${REDACTED}; other=1`,
    ],
    ['key=value secrets', 'signature=abc&api_key=xyz', `signature=${REDACTED}&api_key=${REDACTED}`],
  ])('hides %s', (_case, input, expected) => {
    expect(redactString(input)).toBe(expected);
  });
});

describe('redact', () => {
  it('replaces string and object values of sensitive fields at any depth', () => {
    const input = {
      job: { emailMessageId: '18c2f0a1b2c3d4e5', period: '2026-10' },
      nested: {
        accessToken: 'abc',
        APP_ENCRYPTION_KEY: 'key',
        authorization: 'Bearer x',
        cookies: [{ name: 'token_v2', value: 'v' }],
        'refresh-token': 'abc',
        storageState: { cookies: [] },
        subject: 'Your workspace export is ready',
      },
    };

    expect(redact(input)).toEqual({
      job: { emailMessageId: '18c2f0a1b2c3d4e5', period: '2026-10' },
      nested: {
        accessToken: REDACTED,
        APP_ENCRYPTION_KEY: REDACTED,
        authorization: REDACTED,
        cookies: REDACTED,
        'refresh-token': REDACTED,
        storageState: REDACTED,
        subject: REDACTED,
      },
    });
  });

  it('keeps booleans and numbers under sensitive names', () => {
    expect(redact({ cookieCount: 2, tokenOk: true })).toEqual({ cookieCount: 2, tokenOk: true });
  });

  it('redacts free text inside ordinary fields and arrays', () => {
    expect(redact({ notes: ['https://x.example.com/a?b=c'] })).toEqual({
      notes: [`https://x.example.com/a${REDACTED}`],
    });
  });

  it('serializes errors with only safe properties, and redacts their text', () => {
    const cause = new Error('upstream https://api.example.com/x?key=1');
    const error = Object.assign(new Error('failed for Bearer abc', { cause }), {
      code: 'E_FAIL',
      request: { headers: { cookie: 'token_v2=1' } },
      status: 503,
    });

    const result = redact({ err: error }) as { err: Record<string, unknown> };

    expect(result.err).toMatchObject({
      cause: { message: `upstream https://api.example.com/x${REDACTED}`, name: 'Error' },
      code: 'E_FAIL',
      message: `failed for Bearer ${REDACTED}`,
      name: 'Error',
      status: 503,
    });
    expect(result.err).not.toHaveProperty('request');
    expect(JSON.stringify(result)).not.toContain('Bearer abc');
  });

  it('never dumps bytes, and survives cycles and deep nesting', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };

    cyclic.self = cyclic;

    let deep: Record<string, unknown> = { leaf: true };

    for (let level = 0; level < 12; level += 1) {
      deep = { deep };
    }

    expect(redact({ data: Buffer.from('secret bytes') })).toEqual({ data: '[12 bytes]' });
    expect(redact(cyclic)).toEqual({ name: 'loop', self: '[circular]' });
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });

  it('keeps a shared, non-cyclic reference', () => {
    const shared = { period: '2026-10' };

    expect(redact({ a: shared, b: shared })).toEqual({ a: shared, b: shared });
  });

  it('formats dates and drops functions', () => {
    expect(redact({ at: new Date('2026-10-01T00:00:00.000Z'), run: () => 1 })).toEqual({
      at: '2026-10-01T00:00:00.000Z',
      run: undefined,
    });
  });
});
