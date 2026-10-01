import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../api/health.js';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ok with the short commit SHA and disables caching', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef0123456789abcdef01234567');

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ ok: true, version: '0123456' });
  });

  it('reports an unknown version outside a Vercel Git deployment', async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);

    expect(await GET().json()).toEqual({ ok: true, version: 'unknown' });
  });
});
