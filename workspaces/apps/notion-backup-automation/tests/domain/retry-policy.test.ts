import { describe, expect, it } from 'vitest';

import {
  canRetry,
  elapsedBackoffSec,
  IN_TICK_RETRY_DELAYS_MS,
  inTickRetryDelayMs,
  retryBackoffSec,
  RETRY_WINDOW_SEC,
} from '../../src/domain/retry-policy.js';
import { policy } from '../support/jobs.js';

describe('retryBackoffSec', () => {
  it('grows 5 m → 15 m → 45 m → 2 h 15 m → 6 h, then stays at 6 h', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((retry) => retryBackoffSec(retry))).toEqual([
      300, 900, 2700, 8100, 21_600, 21_600, 21_600,
    ]);
  });

  it('uses a longer Retry-After, rounded up, and caps it at 6 h', () => {
    expect(retryBackoffSec(1, 600.2)).toBe(601);
    expect(retryBackoffSec(2, 60)).toBe(900);
    expect(retryBackoffSec(1, 86_400)).toBe(21_600);
  });

  it('ignores a malformed Retry-After', () => {
    expect(retryBackoffSec(1, Number.NaN)).toBe(300);
  });
});

describe('canRetry', () => {
  it('never retries a none-budget code', () => {
    expect(canRetry('NOTION_SESSION_EXPIRED', 0, policy)).toBe(false);
  });

  it('allows MAX_STAGE_RETRIES retries of a stage-budget code', () => {
    expect([0, 1, 2, 3].map((retries) => canRetry('NOTION_UNAVAILABLE', retries, policy))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(canRetry('BROWSER_LAUNCH_FAILED', 0, { ...policy, maxStageRetries: 0 })).toBe(false);
  });

  it('retries a window-budget code while the backoff so far stays under 24 h', () => {
    expect(elapsedBackoffSec(7)).toBe(76_800);
    expect(elapsedBackoffSec(8)).toBe(98_400);
    expect(canRetry('GMAIL_UNAVAILABLE', 7, policy)).toBe(true);
    expect(canRetry('GMAIL_UNAVAILABLE', 8, policy)).toBe(false);
    expect(elapsedBackoffSec(7)).toBeLessThan(RETRY_WINDOW_SEC);
  });
});

describe('inTickRetryDelayMs', () => {
  it('retries an API call after 0.5 s, 2 s and 8 s, each ±20 %', () => {
    expect(IN_TICK_RETRY_DELAYS_MS).toEqual([500, 2000, 8000]);
    expect([0, 1, 2].map((index) => inTickRetryDelayMs(index, () => 0))).toEqual([400, 1600, 6400]);
    expect([0, 1, 2].map((index) => inTickRetryDelayMs(index, () => 1))).toEqual([600, 2400, 9600]);
  });

  it('allows only three in-tick retries', () => {
    expect(() => inTickRetryDelayMs(3)).toThrow(RangeError);
  });
});
