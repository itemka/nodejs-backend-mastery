import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  classifyTokenError,
  GoogleTokenUnavailableError,
  OAuthTokenProvider,
} from '../../../src/adapters/google/token-provider.js';
import { IntegrationError } from '../../../src/application/integration-error.js';
import {
  DRIVE_SCOPE,
  fakeCredentials,
  FakeGoogle,
  GMAIL_SCOPE,
} from '../../support/fake-google.js';

function provider(google: FakeGoogle, requiredScopes?: readonly string[]) {
  return new OAuthTokenProvider({
    clientId: fakeCredentials.clientId,
    clientSecret: fakeCredentials.clientSecret,
    fetch: google.fetch,
    refreshToken: fakeCredentials.refreshToken,
    retries: 0,
    ...(requiredScopes === undefined ? {} : { requiredScopes }),
  });
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(Error);

  return error as Error;
}

/** Nothing secret may reach a message, a serialized error or an inspected one. */
function expectNoSecrets(error: Error): void {
  for (const text of [error.message, JSON.stringify(error), inspect(error, { depth: 5 })]) {
    expect(text).not.toContain(fakeCredentials.refreshToken);
    expect(text).not.toContain(fakeCredentials.clientSecret);
  }
}

describe('OAuthTokenProvider', () => {
  it('refreshes with the refresh token and caches the access token in memory', async () => {
    const google = new FakeGoogle().onRefresh();
    const tokens = provider(google);

    await expect(tokens.getAccessToken()).resolves.toBe(fakeCredentials.accessToken);
    await expect(tokens.getAccessToken()).resolves.toBe(fakeCredentials.accessToken);

    const refreshes = google.requestsTo('oauth2.googleapis.com/token');
    const form = new URLSearchParams(refreshes[0]?.body);

    expect(refreshes).toHaveLength(1);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe(fakeCredentials.refreshToken);
    expect(form.get('client_id')).toBe(fakeCredentials.clientId);
  });

  it('reports the granted scopes', async () => {
    const tokens = provider(new FakeGoogle().onRefresh(`${GMAIL_SCOPE} ${DRIVE_SCOPE}`));

    await expect(tokens.grantedScopes()).resolves.toEqual([GMAIL_SCOPE, DRIVE_SCOPE]);
  });

  it('fails with GOOGLE_AUTH_REQUIRED on invalid_grant, an expired Testing token', async () => {
    const google = new FakeGoogle().onToken(() =>
      Response.json(
        { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        { status: 400 },
      ),
    );

    const error = await failure(provider(google).getAccessToken());

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
      message: 'Google rejected the refresh token (invalid_grant)',
    });
    expectNoSecrets(error);
  });

  it('fails with GOOGLE_AUTH_REQUIRED when a required scope is missing', async () => {
    const error = await failure(provider(new FakeGoogle().onRefresh(GMAIL_SCOPE)).getAccessToken());

    expect(error).toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
      message: 'The refresh token lacks drive.file',
    });
  });

  it('accepts a token with only the scopes a caller requires', async () => {
    const tokens = provider(new FakeGoogle().onRefresh(DRIVE_SCOPE), [DRIVE_SCOPE]);

    await expect(tokens.getAccessToken()).resolves.toBe(fakeCredentials.accessToken);
  });

  it('reports a token endpoint outage as transient', async () => {
    const google = new FakeGoogle().onToken(() => Response.json({}, { status: 503 }));

    const error = await failure(provider(google).getAccessToken());

    expect(error).toBeInstanceOf(GoogleTokenUnavailableError);
    expect(error).toMatchObject({ status: 503 });
    expectNoSecrets(error);
  });

  it('reports a network failure as transient', async () => {
    const tokens = new OAuthTokenProvider({
      clientId: fakeCredentials.clientId,
      clientSecret: fakeCredentials.clientSecret,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      refreshToken: fakeCredentials.refreshToken,
      retries: 0,
    });

    const error = await failure(tokens.getAccessToken());

    expect(error).toBeInstanceOf(GoogleTokenUnavailableError);
    expect(error).toMatchObject({ status: undefined });
  });

  it('keeps the refresh token and secret out of the provider when serialized or inspected', () => {
    const tokens = provider(new FakeGoogle());

    for (const text of [JSON.stringify(tokens), inspect(tokens, { depth: 5 })]) {
      expect(text).not.toContain(fakeCredentials.refreshToken);
      expect(text).not.toContain(fakeCredentials.clientSecret);
    }
  });
});

/** A gaxios error as `google-auth-library` throws it: branded, with the response attached. */
function gaxiosLike(status: number, data: unknown): Error {
  return Object.assign(new Error('request failed'), {
    response: { data, status },
    [Symbol.for('gaxios-gaxios-error')]: '8.3.1',
  });
}

describe('classifyTokenError', () => {
  it.each(['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_scope'])(
    'maps %s to GOOGLE_AUTH_REQUIRED',
    (oauthError) => {
      expect(classifyTokenError(gaxiosLike(400, { error: oauthError }))).toMatchObject({
        code: 'GOOGLE_AUTH_REQUIRED',
      });
    },
  );

  it('maps 429 and 5xx to transient failures', () => {
    expect(classifyTokenError(gaxiosLike(429, {}))).toBeInstanceOf(GoogleTokenUnavailableError);
    expect(classifyTokenError(gaxiosLike(502, 'Bad Gateway'))).toBeInstanceOf(
      GoogleTokenUnavailableError,
    );
  });

  it('maps another client error to INTEGRATION_UNCLASSIFIED, with the error code only', () => {
    expect(classifyTokenError(gaxiosLike(400, { error: 'invalid_request' }))).toMatchObject({
      code: 'INTEGRATION_UNCLASSIFIED',
      message: 'The Google token endpoint returned HTTP 400 (invalid_request)',
    });
    expect(classifyTokenError(gaxiosLike(400, { error: 'Not A Code!' }))).toMatchObject({
      message: 'The Google token endpoint returned HTTP 400',
    });
  });

  it('maps a gaxios error without a response to a transient failure, and anything else to UNKNOWN_ERROR', () => {
    const noResponse = Object.assign(new Error('socket hang up'), {
      [Symbol.for('gaxios-gaxios-error')]: '8.3.1',
    });

    expect(classifyTokenError(noResponse)).toBeInstanceOf(GoogleTokenUnavailableError);
    expect(classifyTokenError(new TypeError('a bug'))).toMatchObject({ code: 'UNKNOWN_ERROR' });
  });
});
