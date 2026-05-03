import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../../src/eval/concurrency.js';

describe('runWithConcurrency', () => {
  it('returns an empty array when items is empty', async () => {
    const result = await runWithConcurrency<number, number>([], 3, (n) => Promise.resolve(n));

    expect(result).toEqual([]);
  });

  it('preserves input order regardless of completion order', async () => {
    const items = [10, 50, 30, 5];
    const result = await runWithConcurrency(items, 2, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));

      return delay * 2;
    });

    expect(result).toEqual([20, 100, 60, 10]);
  });

  it('limits concurrency to the configured value', async () => {
    let inFlight = 0;
    let observedMax = 0;

    const items = [0, 1, 2, 3, 4, 5];
    await runWithConcurrency(items, 2, async (n) => {
      inFlight += 1;
      observedMax = Math.max(observedMax, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return n;
    });

    expect(observedMax).toBe(2);
  });

  it('clamps an above-the-list limit to the list length', async () => {
    const items = [1, 2];
    const result = await runWithConcurrency(items, 100, (n) => Promise.resolve(n + 1));

    expect(result).toEqual([2, 3]);
  });

  it('propagates worker errors', async () => {
    const items = [1, 2, 3];

    await expect(
      runWithConcurrency(items, 2, (n) => {
        if (n === 2) {
          return Promise.reject(new Error('boom'));
        }

        return Promise.resolve(n);
      }),
    ).rejects.toThrow(/boom/);
  });
});
