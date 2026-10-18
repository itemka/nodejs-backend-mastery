import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { ConsentError } from '../../../src/adapters/google/loopback-consent.js';
import {
  authorizeOffline,
  createOAuthClient,
  missingScopes,
  parseScopes,
  shortScope,
} from '../../../src/adapters/google/oauth-client.js';
import {
  browserThatConsents,
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  GMAIL_SCOPE,
} from '../../support/fake-google.js';

function client(google: FakeGoogle) {
  return createOAuthClient({
    clientId: fakeCredentials.clientId,
    clientSecret: fakeCredentials.clientSecret,
    fetch: google.fetch,
    retries: 0,
  });
}

function grantResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    access_token: fakeCredentials.accessToken,
    expires_in: 3599,
    refresh_token: fakeCredentials.refreshToken,
    scope: `${GMAIL_SCOPE} ${DRIVE_SCOPE}`,
    token_type: 'Bearer',
    ...overrides,
  });
}

async function consentFailure(promise: Promise<unknown>): Promise<ConsentError> {
  const error = await promise.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(ConsentError);

  return error as ConsentError;
}

describe('authorizeOffline', () => {
  it('runs a PKCE consent for both scopes and returns the refresh token', async () => {
    const google = new FakeGoogle().onToken(() => grantResponse());
    const browser = browserThatConsents();

    const grant = await authorizeOffline(client(google), { openBrowser: browser.openBrowser });

    expect(grant).toEqual({
      accessToken: fakeCredentials.accessToken,
      refreshToken: fakeCredentials.refreshToken,
      scopes: [GMAIL_SCOPE, DRIVE_SCOPE],
    });

    const consent = browser.consentUrls[0]?.searchParams;
    const exchange = new URLSearchParams(google.requestsTo('oauth2.googleapis.com/token')[0]?.body);
    const verifier = exchange.get('code_verifier') ?? '';

    expect(Object.fromEntries(consent ?? [])).toMatchObject({
      access_type: 'offline',
      client_id: fakeCredentials.clientId,
      code_challenge_method: 'S256',
      prompt: 'consent',
      response_type: 'code',
      scope: `${GMAIL_SCOPE} ${DRIVE_SCOPE}`,
    });
    expect(consent?.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(consent?.get('state')?.length).toBeGreaterThanOrEqual(43);
    expect(consent?.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(Object.fromEntries(exchange)).toMatchObject({
      code: 'fake-authorization-code',
      grant_type: 'authorization_code',
      redirect_uri: consent?.get('redirect_uri'),
    });
  });

  it('uses a new state and verifier for every consent', async () => {
    const google = new FakeGoogle().onToken(() => grantResponse());
    const browser = browserThatConsents();

    await authorizeOffline(client(google), { openBrowser: browser.openBrowser });
    await authorizeOffline(client(google), { openBrowser: browser.openBrowser });

    const [first, second] = browser.consentUrls.map((url) => url.searchParams);

    expect(first?.get('state')).not.toBe(second?.get('state'));
    expect(first?.get('code_challenge')).not.toBe(second?.get('code_challenge'));
  });

  it('fails when Google returns no refresh token', async () => {
    const google = new FakeGoogle().onToken(() => grantResponse({ refresh_token: undefined }));
    const { openBrowser } = browserThatConsents();

    expect(await consentFailure(authorizeOffline(client(google), { openBrowser }))).toMatchObject({
      reason: 'MISSING_REFRESH_TOKEN',
    });
  });

  it('fails when the user did not grant every scope', async () => {
    const google = new FakeGoogle().onToken(() => grantResponse({ scope: GMAIL_SCOPE }));
    const { openBrowser } = browserThatConsents();

    expect(await consentFailure(authorizeOffline(client(google), { openBrowser }))).toMatchObject({
      message: expect.stringContaining('Not granted: drive.file') as string,
      reason: 'MISSING_SCOPES',
    });
  });

  it('fails on a state mismatch without exchanging the code', async () => {
    const google = new FakeGoogle().onToken(() => grantResponse());
    const { openBrowser } = browserThatConsents(() => ({ state: 'forged-state' }));

    expect(await consentFailure(authorizeOffline(client(google), { openBrowser }))).toMatchObject({
      reason: 'STATE_MISMATCH',
    });
    expect(google.requests).toEqual([]);
  });

  it('reports a refused code exchange by its OAuth error code only', async () => {
    const google = new FakeGoogle().onToken(() =>
      Response.json({ error: 'invalid_grant', error_description: 'Bad Request' }, { status: 400 }),
    );
    const { openBrowser } = browserThatConsents();

    const error = await consentFailure(authorizeOffline(client(google), { openBrowser }));

    expect(error).toMatchObject({
      message: 'Google refused the authorization code (invalid_grant)',
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
    expect(inspect(error, { depth: 5 })).not.toContain(fakeCredentials.clientSecret);
    expect(inspect(error, { depth: 5 })).not.toContain('fake-authorization-code');
  });
});

describe('scope helpers', () => {
  it('parses, compares and shortens scopes', () => {
    expect(parseScopes(`  ${GMAIL_SCOPE}\n${DRIVE_SCOPE} `)).toEqual([GMAIL_SCOPE, DRIVE_SCOPE]);
    expect(parseScopes()).toEqual([]);
    expect(missingScopes([DRIVE_SCOPE])).toEqual([GMAIL_SCOPE]);
    expect(missingScopes([GMAIL_SCOPE, DRIVE_SCOPE, 'openid'])).toEqual([]);
    expect(shortScope(GMAIL_SCOPE)).toBe('gmail.readonly');
    expect(shortScope('openid')).toBe('openid');
  });
});
