import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { IdTokenError, isOwner, verifyIdToken } from '../../../src/adapters/google/id-token.js';
import {
  createWebOAuthClient,
  finishWebConsent,
  startWebConsent,
  WebConsentError,
} from '../../../src/adapters/google/web-consent.js';
import {
  idToken,
  OWNER_EMAIL,
  serveGoogleSignIn,
  WEB_CLIENT_ID,
  WEB_CLIENT_SECRET,
  WEB_REFRESH_TOKEN,
} from '../../support/fake-google-identity.js';
import { DRIVE_SCOPE, FakeGoogle, GMAIL_SCOPE } from '../../support/fake-google.js';

const BASE = 'https://nba.example.vercel.app';

function webClient(google: FakeGoogle) {
  return createWebOAuthClient({
    appBaseUrl: BASE,
    clientId: WEB_CLIENT_ID,
    clientSecret: WEB_CLIENT_SECRET,
    fetch: google.fetch,
    retries: 0,
  });
}

describe('startWebConsent', () => {
  it('asks a re-login for both scopes offline, with a full consent and PKCE S256', async () => {
    const { codeVerifier, url } = await startWebConsent(webClient(new FakeGoogle()), 'state-1');
    const params = new URL(url).searchParams;

    expect(params.get('redirect_uri')).toBe(`${BASE}/oauth/google/callback`);
    expect(params.get('scope')?.split(' ')).toEqual(['openid', 'email', GMAIL_SCOPE, DRIVE_SCOPE]);
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toBe('state-1');
    expect(url).not.toContain(codeVerifier);
  });
});

describe('finishWebConsent', () => {
  it('exchanges the code with its verifier and returns the tokens', async () => {
    const google = serveGoogleSignIn(new FakeGoogle(), { refreshToken: WEB_REFRESH_TOKEN });
    const tokens = await finishWebConsent(webClient(google), {
      code: 'code-1',
      codeVerifier: 'verifier-1',
    });
    const form = new URLSearchParams(google.requestsTo('oauth2.googleapis.com/token')[0]?.body);

    expect(form.get('code_verifier')).toBe('verifier-1');
    expect(form.get('redirect_uri')).toBe(`${BASE}/oauth/google/callback`);
    expect(tokens.refreshToken).toBe(WEB_REFRESH_TOKEN);
    expect(tokens.scopes).toEqual(expect.arrayContaining([GMAIL_SCOPE, DRIVE_SCOPE]));
  });

  it('refuses a failed exchange without its code, verifier or secret', async () => {
    const google = new FakeGoogle().onToken(() =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    const error = await finishWebConsent(webClient(google), {
      code: 'secret-code',
      codeVerifier: 'secret-verifier',
    }).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(WebConsentError);

    const text = `${(error as Error).message} ${inspect(error, { depth: 5 })}`;

    expect(text).toContain('invalid_grant');
    expect(text).not.toContain('secret-code');
    expect(text).not.toContain('secret-verifier');
    expect(text).not.toContain(WEB_CLIENT_SECRET);
  });
});

describe('verifyIdToken', () => {
  it('accepts a token Google signed for the Web client', async () => {
    const google = serveGoogleSignIn(new FakeGoogle());

    await expect(verifyIdToken(webClient(google), idToken(), WEB_CLIENT_ID)).resolves.toEqual({
      email: OWNER_EMAIL,
      emailVerified: true,
    });
  });

  it.each([
    ['another audience', idToken({ aud: 'other-client.apps.googleusercontent.com' })],
    ['another issuer', idToken({ iss: 'https://evil.example' })],
    ['an expired token', idToken({ exp: Math.floor(Date.now() / 1000) - 3600, iat: 0 })],
    ['a forged signature', `${idToken().slice(0, -10)}AAAAAAAAAA`],
  ])('refuses %s, without the token in the error', async (_name, token) => {
    const google = serveGoogleSignIn(new FakeGoogle());
    const error = await verifyIdToken(webClient(google), token, WEB_CLIENT_ID).catch(
      (error_: unknown) => error_,
    );

    expect(error).toBeInstanceOf(IdTokenError);
    expect(inspect(error, { depth: 5 })).not.toContain(token.split('.')[1]);
  });
});

describe('isOwner', () => {
  it('accepts only the owner address, verified, in any case', () => {
    expect(isOwner({ email: 'Owner@Example.com', emailVerified: true }, OWNER_EMAIL)).toBe(true);
    expect(isOwner({ email: OWNER_EMAIL, emailVerified: false }, OWNER_EMAIL)).toBe(false);
    expect(isOwner({ email: 'other@example.com', emailVerified: true }, OWNER_EMAIL)).toBe(false);
  });
});
