import { createSign, generateKeyPairSync } from 'node:crypto';

import type { FakeGoogle } from './fake-google.js';
import { DRIVE_SCOPE, fakeCredentials, GMAIL_SCOPE } from './fake-google.js';

/** One RSA key for the test run, published as Google publishes its ID-token keys. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_ID = 'fake-signing-key';

export const WEB_CLIENT_ID = 'fake-web-client.apps.googleusercontent.com';
export const WEB_CLIENT_SECRET = `fake-web-${'w'.repeat(20)}`;
export const OWNER_EMAIL = 'owner@example.com';
export const WEB_REFRESH_TOKEN = `1//0w${'W'.repeat(32)}aBc9`;
export const BOTH_SCOPES = `openid https://www.googleapis.com/auth/userinfo.email ${GMAIL_SCOPE} ${DRIVE_SCOPE}`;

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An RS256 ID token signed with the published key; `claims` override the owner's defaults. */
export function idToken(claims: Record<string, unknown> = {}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const signed = `${base64url({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })}.${base64url({
    aud: WEB_CLIENT_ID,
    email: OWNER_EMAIL,
    email_verified: true,
    exp: nowSec + 3600,
    iat: nowSec,
    iss: 'https://accounts.google.com',
    sub: '100000000000000000001',
    ...claims,
  })}`;

  return `${signed}.${createSign('RSA-SHA256').update(signed).sign(privateKey, 'base64url')}`;
}

/**
 * Google after a phone re-login: it refreshes the Web token with the Web client only, and
 * answers anything else, such as the expired Desktop token in `.env.local`, with `invalid_grant`.
 */
export function refreshWebTokenOnly(google: FakeGoogle): FakeGoogle {
  return google.onToken((form) =>
    form.get('refresh_token') === WEB_REFRESH_TOKEN && form.get('client_id') === WEB_CLIENT_ID
      ? Response.json({
          access_token: fakeCredentials.accessToken,
          expires_in: 3599,
          scope: `${GMAIL_SCOPE} ${DRIVE_SCOPE}`,
          token_type: 'Bearer',
        })
      : Response.json({ error: 'invalid_grant' }, { status: 400 }),
  );
}

export interface CodeExchange {
  readonly idToken?: string;
  readonly refreshToken?: string;
  readonly scope?: string;
}

/**
 * Google's side of a Web sign-in: the published keys, a code exchange answered with `exchange`,
 * and refreshes of any token with both scopes.
 */
export function serveGoogleSignIn(google: FakeGoogle, exchange: CodeExchange = {}): FakeGoogle {
  return google
    .on('GET', 'www.googleapis.com/oauth2/v1/certs', () =>
      Response.json({ [KEY_ID]: publicKey.export({ format: 'pem', type: 'spki' }) }),
    )
    .onToken((form) =>
      Response.json(
        form.get('grant_type') === 'authorization_code'
          ? {
              access_token: fakeCredentials.accessToken,
              expires_in: 3599,
              id_token: exchange.idToken ?? idToken(),
              scope: exchange.scope ?? BOTH_SCOPES,
              token_type: 'Bearer',
              ...(exchange.refreshToken === undefined
                ? {}
                : { refresh_token: exchange.refreshToken }),
            }
          : {
              access_token: fakeCredentials.accessToken,
              expires_in: 3599,
              scope: `${GMAIL_SCOPE} ${DRIVE_SCOPE}`,
              token_type: 'Bearer',
            },
      ),
    );
}
