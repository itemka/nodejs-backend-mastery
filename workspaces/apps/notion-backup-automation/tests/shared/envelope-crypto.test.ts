import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Envelope } from '../../src/shared/envelope-crypto.js';
import {
  createEnvelopeKey,
  EnvelopeError,
  openEnvelope,
  sealEnvelope,
} from '../../src/shared/envelope-crypto.js';

const keyBase64 = Buffer.alloc(32, 7).toString('base64');
const key = createEnvelopeKey(keyBase64);
const context = 'nba:test:notion-storage-state:v1';
const createdAt = new Date('2026-10-01T12:00:00.000Z');
const plaintext = JSON.stringify({ cookies: [{ name: 'token_v2', value: 'session' }] });
const meta = { authCookieExpiresAt: '2027-10-01T00:00:00.000Z', hasFileHostCookie: true };

function seal(): Envelope {
  return sealEnvelope({ context, createdAt, key, meta, plaintext });
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvelopeError) {
      return error.code;
    }

    throw error;
  }

  throw new Error('Expected an EnvelopeError');
}

/** Flips the first bit of a base64url field, keeping its length. */
function flip(value: string): string {
  const bytes = Buffer.from(value, 'base64url');

  bytes[0] = (bytes[0] ?? 0) ^ 1;

  return bytes.toString('base64url');
}

describe('createEnvelopeKey', () => {
  it('derives kid from the first 8 hex characters of the key SHA-256', () => {
    const expected = createHash('sha256')
      .update(Buffer.from(keyBase64, 'base64'))
      .digest('hex')
      .slice(0, 8);

    expect(key.kid).toBe(expected);
  });

  it('keeps the key bytes out of JSON', () => {
    expect(JSON.stringify(key)).not.toContain(keyBase64);
  });

  it.each([
    Buffer.alloc(16, 1).toString('base64'),
    Buffer.alloc(31, 1).toString('base64'),
    Buffer.alloc(33, 1).toString('base64'),
    'not base64 at all',
  ])('rejects a key that is not 32 bytes of base64: %j', (value) => {
    expect(errorCode(() => createEnvelopeKey(value))).toBe('KEY_INVALID');
  });
});

describe('sealEnvelope and openEnvelope', () => {
  it('round-trips the plaintext and metadata', () => {
    const envelope = seal();

    expect(envelope).toMatchObject({
      alg: 'A256GCM',
      createdAt: '2026-10-01T12:00:00.000Z',
      kid: key.kid,
      meta,
      v: 1,
    });
    expect(JSON.stringify(envelope)).not.toContain('session');
    expect(openEnvelope({ context, envelope, key })).toEqual({
      createdAt: '2026-10-01T12:00:00.000Z',
      meta,
      plaintext,
    });
  });

  it('survives a JSON round trip and a different metadata key order', () => {
    const envelope = seal();
    // Stored as text in Redis, then parsed back.
    const stored = JSON.stringify({
      ...envelope,
      meta: { hasFileHostCookie: true, ...envelope.meta },
    });
    const reordered = JSON.parse(stored) as unknown;

    expect(openEnvelope({ context, envelope: reordered, key }).plaintext).toBe(plaintext);
  });

  it('uses a new IV for every seal', () => {
    const first = seal();
    const second = seal();

    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  it.each(['iv', 'tag', 'ct'] as const)('rejects a modified %s', (field) => {
    const envelope = seal();

    expect(
      errorCode(() =>
        openEnvelope({ context, envelope: { ...envelope, [field]: flip(envelope[field]) }, key }),
      ),
    ).toBe('AUTHENTICATION_FAILED');
  });

  it('rejects another context (the AAD), such as another APP_ENV', () => {
    expect(
      errorCode(() =>
        openEnvelope({ context: 'nba:prod:notion-storage-state:v1', envelope: seal(), key }),
      ),
    ).toBe('AUTHENTICATION_FAILED');
  });

  it.each([
    ['meta', { meta: { ...meta, hasFileHostCookie: false } }],
    ['createdAt', { createdAt: '2026-10-02T12:00:00.000Z' }],
  ])('rejects a modified %s, which is authenticated', (_field, change) => {
    expect(
      errorCode(() => openEnvelope({ context, envelope: { ...seal(), ...change }, key })),
    ).toBe('AUTHENTICATION_FAILED');
  });

  it('reports a different key separately from tampering', () => {
    const otherKey = createEnvelopeKey(Buffer.alloc(32, 8).toString('base64'));

    expect(errorCode(() => openEnvelope({ context, envelope: seal(), key: otherKey }))).toBe(
      'KEY_MISMATCH',
    );
  });

  it.each([
    ['not an object', 'text'],
    ['an unknown version', { ...seal(), v: 2 }],
    ['a short IV', { ...seal(), iv: Buffer.alloc(8).toString('base64url') }],
    ['a short tag', { ...seal(), tag: Buffer.alloc(12).toString('base64url') }],
  ])('rejects %s as an invalid envelope', (_case, envelope) => {
    expect(errorCode(() => openEnvelope({ context, envelope, key }))).toBe('ENVELOPE_INVALID');
  });
});
