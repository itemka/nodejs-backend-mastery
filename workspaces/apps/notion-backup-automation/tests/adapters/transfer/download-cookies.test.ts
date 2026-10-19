import { describe, expect, it } from 'vitest';

import type { SessionCookie } from '../../../src/adapters/transfer/download-cookies.js';
import {
  cookieHeaderFor,
  parseSessionCookies,
} from '../../../src/adapters/transfer/download-cookies.js';
import { IntegrationError } from '../../../src/application/integration-error.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const FILE_URL = new URL('https://file.notion.com/f/t/0000/Export-0000.zip?table=user_export');
const IN_A_YEAR = NOW.getTime() / 1000 + 365 * 24 * 3600;

function cookie(overrides: Partial<SessionCookie> & { name: string }): SessionCookie {
  return {
    domain: '.notion.com',
    expires: IN_A_YEAR,
    path: '/',
    secure: true,
    value: `${overrides.name}-value`,
    ...overrides,
  };
}

/** A `storageState()` as Playwright writes it, with fields the parser ignores. */
function storageState(cookies: readonly SessionCookie[]): string {
  return JSON.stringify({
    cookies: cookies.map((item) => ({ ...item, httpOnly: true, sameSite: 'Lax' })),
    origins: [
      {
        localStorage: [{ name: 'LRU:KeyValueStore', value: '{}' }],
        origin: 'https://app.notion.com',
      },
    ],
  });
}

describe('cookieHeaderFor', () => {
  it('sends only the cookies whose domain and path match file.notion.com', () => {
    const cookies = [
      cookie({ name: 'file_token' }),
      cookie({ domain: 'file.notion.com', name: 'host_only_file' }),
      cookie({ domain: '.file.notion.com', name: 'file_subdomain' }),
      cookie({ domain: '.app.notion.com', name: 'token_v2' }),
      cookie({ domain: 'app.notion.com', name: 'host_only_app' }),
      cookie({ domain: 'notion.com', name: 'host_only_apex' }),
      cookie({ domain: '.notion.so', name: 'legacy_so' }),
      cookie({ domain: '.evilnotion.com', name: 'look_alike' }),
      cookie({ domain: '.notion.com.evil.example', name: 'suffix_trick' }),
      cookie({ domain: '.com', name: 'public_suffix' }),
    ];

    expect(cookieHeaderFor(cookies, FILE_URL, NOW)).toBe(
      'file_token=file_token-value; host_only_file=host_only_file-value; file_subdomain=file_subdomain-value',
    );
  });

  it('matches paths by whole segments and puts longer paths first', () => {
    const cookies = [
      cookie({ name: 'root' }),
      cookie({ name: 'files', path: '/f' }),
      cookie({ name: 'files_slash', path: '/f/t/' }),
      cookie({ name: 'exact', path: '/f/t/0000/Export-0000.zip' }),
      cookie({ name: 'prefix_only', path: '/f/t/00' }),
      cookie({ name: 'other', path: '/api' }),
    ];

    expect(cookieHeaderFor(cookies, FILE_URL, NOW)).toBe(
      'exact=exact-value; files_slash=files_slash-value; files=files-value; root=root-value',
    );
  });

  it('drops expired cookies and keeps session cookies', () => {
    const cookies = [
      cookie({ expires: NOW.getTime() / 1000 - 1, name: 'expired' }),
      cookie({ expires: NOW.getTime() / 1000, name: 'expires_now' }),
      cookie({ expires: -1, name: 'session' }),
    ];

    expect(cookieHeaderFor(cookies, FILE_URL, NOW)).toBe('session=session-value');
  });

  it('never sends a secure cookie over plain HTTP', () => {
    const cookies = [cookie({ name: 'secure' }), cookie({ name: 'plain', secure: false })];

    expect(cookieHeaderFor(cookies, new URL('http://file.notion.com/f/x'), NOW)).toBe(
      'plain=plain-value',
    );
  });

  it('drops cookies that would split or end the header', () => {
    const cookies = [
      cookie({ name: 'semicolon', value: 'a; injected=1' }),
      cookie({ name: 'newline', value: 'a\r\nX-Injected: 1' }),
      cookie({ name: 'bad name' }),
      cookie({ name: 'good', value: 'a=b,c' }),
    ];

    expect(cookieHeaderFor(cookies, FILE_URL, NOW)).toBe('good=a=b,c');
  });

  it('returns undefined when no cookie matches', () => {
    expect(
      cookieHeaderFor([cookie({ domain: '.app.notion.com', name: 'token_v2' })], FILE_URL, NOW),
    ).toBeUndefined();
    expect(cookieHeaderFor([], FILE_URL, NOW)).toBeUndefined();
  });
});

describe('parseSessionCookies', () => {
  it("reads the cookies of Playwright's storageState", () => {
    const cookies = parseSessionCookies(storageState([cookie({ name: 'file_token' })]));

    expect(cookies).toEqual([cookie({ name: 'file_token' })]);
  });

  it.each([
    ['not JSON', 'file_token=abc'],
    ['no cookie list', JSON.stringify({ origins: [] })],
    [
      'a cookie without a domain',
      JSON.stringify({ cookies: [{ name: 'a', value: 'secret-value' }] }),
    ],
  ])('rejects %s as NOTION_SESSION_EXPIRED without echoing it', (_case, state) => {
    let thrown: unknown;

    try {
      parseSessionCookies(state);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IntegrationError);
    expect(thrown).toMatchObject({ code: 'NOTION_SESSION_EXPIRED' });
    expect((thrown as Error).message).not.toMatch(/abc|secret-value/);
  });
});
