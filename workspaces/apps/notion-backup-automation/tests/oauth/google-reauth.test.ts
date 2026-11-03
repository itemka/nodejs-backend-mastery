import { describe, expect, it, vi } from 'vitest';

import { stateHash } from '../../src/adapters/persistence/google-login-store.js';
import { idToken, WEB_REFRESH_TOKEN } from '../support/fake-google-identity.js';
import { DRIVE_SCOPE, GMAIL_SCOPE } from '../support/fake-google.js';
import type { OAuthHarness } from '../support/oauth.js';
import { BASE, googleCallback, location, oauthHarness } from '../support/oauth.js';

function startReauth(harness: OAuthHarness): Promise<Response> {
  return harness.serve(new Request(`${BASE}/oauth/google/reauth`));
}

/** The link, Google's consent, and the callback; returns the page shown at the end. */
async function reauth(harness: OAuthHarness): Promise<Response> {
  return googleCallback(harness, location(await startReauth(harness)));
}

describe('/oauth/google/reauth', () => {
  it('starts a full Google consent for Gmail and Drive, and stores nothing else', async () => {
    const harness = oauthHarness();
    const toGoogle = location(await startReauth(harness));
    const state = toGoogle.searchParams.get('state') ?? '';

    expect(toGoogle.host).toBe('accounts.google.com');
    expect(toGoogle.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'email',
      GMAIL_SCOPE,
      DRIVE_SCOPE,
    ]);
    expect(toGoogle.searchParams.get('access_type')).toBe('offline');
    expect(toGoogle.searchParams.get('prompt')).toBe('consent');
    expect(toGoogle.searchParams.get('redirect_uri')).toBe(`${BASE}/oauth/google/callback`);
    // Kept for 15 minutes under the state's SHA-256 only.
    expect(harness.redis.expirySeconds.get(`{nba:test}:google-login:${stateHash(state)}`)).toBe(
      900,
    );
    expect(JSON.stringify([...harness.redis.strings])).not.toContain(state);
    expect(harness.saved).toEqual([]);
  });

  it('allows 10 starts an hour', async () => {
    const harness = oauthHarness();

    for (let index = 0; index < 10; index += 1) {
      await startReauth(harness);
    }

    const limited = await startReauth(harness);

    expect(limited.status).toBe(429);
    expect(limited.headers.get('location')).toBeNull();
  });
});

describe('the re-login callback', () => {
  it("saves the owner's Web-client token, then checks it and resumes the job", async () => {
    const harness = oauthHarness({ refreshToken: WEB_REFRESH_TOKEN });

    harness.relogin = { ...harness.relogin, resumedJobId: '2026-12' };

    const page = await reauth(harness);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Google access renewed, and job 2026-12 resumed');
    expect(harness.saved).toEqual([
      { client: 'web', refreshToken: WEB_REFRESH_TOKEN, scopes: [GMAIL_SCOPE, DRIVE_SCOPE] },
    ]);
    expect(harness.renewals).toEqual([1]);
    expect(harness.logs.join('\n')).not.toContain(WEB_REFRESH_TOKEN);
  });

  it.each([
    ['another account', { email: 'someone@example.com' }],
    ['an unverified address', { email_verified: false }],
  ])('refuses %s with 403 and saves nothing', async (_name, claims) => {
    const harness = oauthHarness({ idToken: idToken(claims), refreshToken: WEB_REFRESH_TOKEN });
    const page = await reauth(harness);

    expect(page.status).toBe(403);
    expect(harness.saved).toEqual([]);
    expect(harness.renewals).toEqual([]);
  });

  it.each([
    ['a missing Drive scope', { refreshToken: WEB_REFRESH_TOKEN, scope: `openid ${GMAIL_SCOPE}` }],
    ['no refresh token', {}],
  ])('refuses %s and saves nothing', async (_name, exchange) => {
    const harness = oauthHarness(exchange);
    const page = await reauth(harness);

    expect(page.status).toBe(400);
    expect(await page.text()).toContain('Allow both Gmail and Google Drive');
    expect(harness.saved).toEqual([]);
  });

  it('says so when the saved token fails its check', async () => {
    const harness = oauthHarness({ refreshToken: WEB_REFRESH_TOKEN });

    harness.relogin = {
      ...harness.relogin,
      google: { code: 'GMAIL_UNAVAILABLE', ok: false, probe: 'google' },
    };

    const page = await reauth(harness);

    expect(page.status).toBe(502);
    expect(await page.text()).toContain('GMAIL_UNAVAILABLE');
  });

  it('says a busy job was not resumed, and that the renewal stands (review, 2026-11-02)', async () => {
    const harness = oauthHarness({ refreshToken: WEB_REFRESH_TOKEN });

    harness.relogin = { ...harness.relogin, pendingJobId: '2026-12' };

    const page = await reauth(harness);
    const text = await page.text();

    expect(page.status).toBe(200);
    expect(text).toContain('Google access renewed. Job 2026-12 was busy');
    expect(text).toContain('the next daily cron resumes it');
  });

  it('never says "nothing was saved" once the token is saved (review, 2026-11-02)', async () => {
    const harness = oauthHarness({ refreshToken: WEB_REFRESH_TOKEN });

    vi.spyOn(harness.deps.renewal.relogin, 'afterRenewal').mockRejectedValue(
      new Error('redis down'),
    );

    const page = await reauth(harness);
    const text = await page.text();

    expect(page.status).toBe(500);
    expect(text).toContain('The new Google access was saved');
    expect(text).not.toContain('Nothing was');
    expect(harness.saved).toHaveLength(1);
  });

  it('refuses a Google refusal, then the same state again', async () => {
    const harness = oauthHarness({ refreshToken: WEB_REFRESH_TOKEN });
    const toGoogle = location(await startReauth(harness));

    const refused = await googleCallback(harness, toGoogle, { error: 'access_denied' });
    const replayed = await googleCallback(harness, toGoogle);

    expect(refused.status).toBe(400);
    expect(replayed.status).toBe(400);
    expect(harness.saved).toEqual([]);
  });
});

describe('/oauth/google/* failing partway (review, 2026-11-02)', () => {
  it('never claims that nothing changed', async () => {
    const harness = oauthHarness();

    vi.spyOn(harness.deps.logins, 'save').mockRejectedValue(new Error('redis down'));

    const page = await startReauth(harness);
    const text = await page.text();

    expect(page.status).toBe(500);
    expect(text).toContain('This step did not finish');
    expect(text).not.toContain('Nothing was');
  });

  it('answers only GET, and 404 for any other path', async () => {
    const harness = oauthHarness();
    const posted = await harness.serve(
      new Request(`${BASE}/oauth/google/reauth`, { method: 'POST' }),
    );
    const unknown = await harness.serve(new Request(`${BASE}/oauth/token`));

    expect(posted.status).toBe(405);
    expect(posted.headers.get('allow')).toBe('GET');
    expect(unknown.status).toBe(404);
  });
});
