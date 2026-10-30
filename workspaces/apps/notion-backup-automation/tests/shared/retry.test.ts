import { describe, expect, it } from 'vitest';

import type { RetryOptions } from '../../src/shared/retry.js';
import { parseRetryAfter, retryTransient, TransientFailure } from '../../src/shared/retry.js';

class FlakyError extends Error {
  readonly retryAfterSec: number | undefined;

  constructor(retryAfterSec?: number) {
    super('flaky');
    this.retryAfterSec = retryAfterSec;
  }
}

/** Options with a recording sleep; `sleeps` holds each wait in ms. */
function options(overrides: Partial<RetryOptions> = {}) {
  const sleeps: number[] = [];
  const retries: number[] = [];

  return {
    options: {
      attempts: 3,
      onRetry: (_error, attempt) => {
        retries.push(attempt);
      },
      sleep: (ms: number) => {
        sleeps.push(ms);

        return Promise.resolve();
      },
      ...overrides,
    } satisfies RetryOptions,
    retries,
    sleeps,
  };
}

/** An attempt that fails transiently with `errors` in turn, then returns `ok`. */
function failingWith(...errors: FlakyError[]) {
  let calls = 0;

  return {
    attempt: () => {
      const error = errors[calls];

      calls += 1;

      return Promise.resolve(error === undefined ? 'ok' : new TransientFailure(error));
    },
    calls: () => calls,
  };
}

describe('retryTransient', () => {
  it('retries a transient failure with exponential backoff, then returns the value', async () => {
    const { options: retryOptions, retries, sleeps } = options();
    const { attempt, calls } = failingWith(new FlakyError(), new FlakyError());

    await expect(retryTransient(attempt, retryOptions)).resolves.toBe('ok');
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(retries).toEqual([1, 2]);
  });

  it('waits the failure’s Retry-After instead of the backoff', async () => {
    const { options: retryOptions, sleeps } = options();
    const { attempt } = failingWith(new FlakyError(4));

    await expect(retryTransient(attempt, retryOptions)).resolves.toBe('ok');
    expect(sleeps).toEqual([4000]);
  });

  it('throws the last failure once no attempt is left', async () => {
    const { options: retryOptions, sleeps } = options({ attempts: 2 });
    const last = new FlakyError();
    const { attempt, calls } = failingWith(new FlakyError(), last);

    await expect(retryTransient(attempt, retryOptions)).rejects.toBe(last);
    expect(calls()).toBe(2);
    expect(sleeps).toEqual([500]);
  });

  it('throws at once when the Retry-After exceeds the in-tick limit', async () => {
    const { options: retryOptions, sleeps } = options();
    const tooLong = new FlakyError(11);
    const { attempt, calls } = failingWith(tooLong);

    await expect(retryTransient(attempt, retryOptions)).rejects.toBe(tooLong);
    expect(calls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('never retries what an attempt throws', async () => {
    const { options: retryOptions } = options();
    const fatal = new Error('fatal');
    let calls = 0;

    await expect(
      retryTransient(() => {
        calls += 1;

        return Promise.reject(fatal);
      }, retryOptions),
    ).rejects.toBe(fatal);
    expect(calls).toBe(1);
  });

  it('starts no attempt after the signal aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('transfer budget exceeded');
    const { options: retryOptions } = options({
      signal: controller.signal,
      sleep: () => {
        controller.abort(reason);

        return Promise.resolve();
      },
    });
    const { attempt, calls } = failingWith(new FlakyError());

    await expect(retryTransient(attempt, retryOptions)).rejects.toBe(reason);
    expect(calls()).toBe(1);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');

  it.each([
    [null, undefined],
    ['', undefined],
    ['30', 30],
    [' 7 ', 7],
    ['Thu, 01 Oct 2026 12:01:00 GMT', 60],
    ['Thu, 01 Oct 2026 11:59:00 GMT', 0],
    ['soon', undefined],
  ])('%s → %s', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });
});
