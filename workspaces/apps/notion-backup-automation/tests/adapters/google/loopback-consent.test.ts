import { afterEach, describe, expect, it } from 'vitest';

import type { LoopbackListener } from '../../../src/adapters/google/loopback-consent.js';
import {
  ConsentError,
  startLoopbackListener,
} from '../../../src/adapters/google/loopback-consent.js';

const STATE = 'expected-state-value';
let listener: LoopbackListener | undefined;

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

async function start(timeoutMs = 5000): Promise<LoopbackListener> {
  listener = await startLoopbackListener({ state: STATE, timeoutMs });

  return listener;
}

function redirect(target: LoopbackListener, query: Record<string, string>, path = '/') {
  const url = new URL(path, target.redirectUri);

  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }

  return fetch(url);
}

async function rejection(target: LoopbackListener): Promise<ConsentError> {
  const error = await target.waitForCallback().catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(ConsentError);

  return error as ConsentError;
}

describe('startLoopbackListener', () => {
  it('listens on 127.0.0.1 at a random port', async () => {
    const target = await start();

    expect(target.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('resolves with the redirect query when state matches and a code arrived', async () => {
    const target = await start();
    const response = await redirect(target, { code: 'auth-code', scope: 'a b', state: STATE });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const params = await target.waitForCallback();

    expect(params.get('code')).toBe('auth-code');
    expect(params.get('scope')).toBe('a b');
  });

  it.each([
    ['a different state', { code: 'auth-code', state: 'other-state' }],
    ['no state', { code: 'auth-code' }],
  ])('aborts on %s', async (_case, query) => {
    const target = await start();
    const response = await redirect(target, query);

    expect(response.status).toBe(400);
    expect(await rejection(target)).toMatchObject({ reason: 'STATE_MISMATCH' });
  });

  it('aborts when Google reports an error, naming only a well-formed error code', async () => {
    const target = await start();

    await redirect(target, { error: 'access_denied', state: STATE });

    expect(await rejection(target)).toMatchObject({
      message: 'Google did not grant access (access_denied)',
      reason: 'ACCESS_DENIED',
    });
  });

  it('does not echo a malformed error code', async () => {
    const target = await start();

    await redirect(target, { error: '<script>alert(1)</script>', state: STATE });

    expect(await rejection(target)).toMatchObject({
      message: 'Google did not grant access (unknown error)',
    });
  });

  it('aborts when no code arrived', async () => {
    const target = await start();

    await redirect(target, { state: STATE });

    expect(await rejection(target)).toMatchObject({ reason: 'MISSING_CODE' });
  });

  it('never reflects the query into the page', async () => {
    const target = await start();
    const response = await redirect(target, { code: '<b>x</b>', state: '<script>x</script>' });

    expect(await response.text()).not.toMatch(/<script>|<b>/);
  });

  it('answers 404 for other paths and keeps waiting', async () => {
    const target = await start();

    const favicon = await redirect(target, {}, '/favicon.ico');

    expect(favicon.status).toBe(404);

    await redirect(target, { code: 'auth-code', state: STATE });

    await expect(target.waitForCallback()).resolves.toBeInstanceOf(URLSearchParams);
  });

  it('decides on the first redirect only', async () => {
    const target = await start();

    await redirect(target, { code: 'first', state: STATE });

    const second = await redirect(target, { code: 'second', state: STATE });

    const params = await target.waitForCallback();

    expect(second.status).toBe(409);
    expect(params.get('code')).toBe('first');
  });

  it('times out when no redirect arrives', async () => {
    const target = await start(20);

    expect(await rejection(target)).toMatchObject({ reason: 'TIMEOUT' });
  });

  it('stops listening once closed', async () => {
    const target = await start();

    await target.close();
    listener = undefined;

    await expect(redirect(target, { code: 'late', state: STATE })).rejects.toThrow();
  });
});
