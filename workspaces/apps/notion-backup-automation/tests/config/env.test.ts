import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadHealthEnv } from '../../src/config/env.js';

const commitSha = '0123456789abcdef0123456789abcdef01234567';

describe('loadHealthEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the commit SHA that Vercel sets for Git deployments', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', commitSha);

    expect(loadHealthEnv()).toEqual({ VERCEL_GIT_COMMIT_SHA: commitSha });
  });

  it('treats a missing SHA as unknown', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);

    expect(loadHealthEnv().VERCEL_GIT_COMMIT_SHA).toBeUndefined();
  });

  it.each(['', 'abc1234', 'not-a-sha', commitSha.toUpperCase()])(
    'treats %j as unknown instead of failing',
    (value) => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', value);

      expect(loadHealthEnv().VERCEL_GIT_COMMIT_SHA).toBeUndefined();
    },
  );
});
