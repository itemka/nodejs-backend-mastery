import { afterEach, describe, expect, it, vi } from 'vitest';

import { QStashSignatureVerifier } from '../../../src/adapters/qstash/qstash-signature-verifier.js';
import { TEST_TOKEN } from '../../support/fixture-secrets.js';
import { signLikeQStash, TEST_BASE_URL, TEST_SIGNING_KEYS } from '../../support/qstash.js';

const url = `${TEST_BASE_URL}/api/jobs/process/2026-10`;
const body = JSON.stringify({ jobId: '2026-10', reason: 'start', token: TEST_TOKEN });
const verifier = new QStashSignatureVerifier(TEST_SIGNING_KEYS);

describe('QStashSignatureVerifier', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a token signed with the current key for this URL and body', async () => {
    const signature = signLikeQStash(TEST_SIGNING_KEYS.current, { body, url });

    await expect(verifier.verify({ body, signature, url })).resolves.toBe(true);
  });

  it('accepts the next key while the keys rotate', async () => {
    const signature = signLikeQStash(TEST_SIGNING_KEYS.next, { body, url });

    await expect(verifier.verify({ body, signature, url })).resolves.toBe(true);
  });

  it('refuses a tampered body', async () => {
    const signature = signLikeQStash(TEST_SIGNING_KEYS.current, { body, url });

    await expect(verifier.verify({ body: `${body} `, signature, url })).resolves.toBe(false);
  });

  it('refuses a token signed for another job’s URL', async () => {
    const signature = signLikeQStash(TEST_SIGNING_KEYS.current, {
      body,
      url: `${TEST_BASE_URL}/api/jobs/process/2026-11`,
    });

    await expect(verifier.verify({ body, signature, url })).resolves.toBe(false);
  });

  it('refuses an expired token', async () => {
    const signature = signLikeQStash(
      TEST_SIGNING_KEYS.current,
      { body, url },
      { expiresInSec: -60 },
    );

    await expect(verifier.verify({ body, signature, url })).resolves.toBe(false);
  });

  it('refuses another issuer, an unknown key, garbage and a missing signature', async () => {
    const otherIssuer = signLikeQStash(
      TEST_SIGNING_KEYS.current,
      { body, url },
      { issuer: 'Other' },
    );
    const unknownKey = signLikeQStash('sig_unknown_0123456789abcdefghijkl', { body, url });

    await expect(verifier.verify({ body, signature: otherIssuer, url })).resolves.toBe(false);
    await expect(verifier.verify({ body, signature: unknownKey, url })).resolves.toBe(false);
    await expect(verifier.verify({ body, signature: 'not.a.jwt', url })).resolves.toBe(false);
    await expect(verifier.verify({ body, signature: '', url })).resolves.toBe(false);
  });

  it('ignores QSTASH_DEV: the public local-dev keys never verify (S3)', async () => {
    vi.stubEnv('QSTASH_DEV', 'true');

    const genuine = signLikeQStash(TEST_SIGNING_KEYS.current, { body, url });
    const devKeyed = signLikeQStash('sig_7kYjw48YW5FSQfGsXzyYEYjF4tq3wR8Z6bCpkQrD4wQ', {
      body,
      url,
    });

    await expect(verifier.verify({ body, signature: genuine, url })).resolves.toBe(true);
    await expect(verifier.verify({ body, signature: devKeyed, url })).resolves.toBe(false);
  });
});
