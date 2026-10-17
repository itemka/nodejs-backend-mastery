import type { ErrorCode } from './error-catalog.js';
import { errorCatalog } from './error-catalog.js';
import type { BackupPolicy } from './policy.js';

const FIRST_RETRY_DELAY_SEC = 5 * 60;
const BACKOFF_FACTOR = 3;
const MAX_RETRY_DELAY_SEC = 6 * 60 * 60;

/** A `window`-budget error is retried while the backoff delays so far add up to less than this. */
export const RETRY_WINDOW_SEC = 24 * 60 * 60;

/**
 * The business-retry delay before retry number `retryNumber` (1-based): 5 m → 15 m → 45 m →
 * 2 h 15 m → 6 h, then 6 h. A longer `Retry-After` wins, within the same 6 h cap.
 */
export function retryBackoffSec(retryNumber: number, retryAfterSec?: number): number {
  const backoff = Math.min(
    FIRST_RETRY_DELAY_SEC * BACKOFF_FACTOR ** (Math.max(retryNumber, 1) - 1),
    MAX_RETRY_DELAY_SEC,
  );

  if (retryAfterSec === undefined || !Number.isFinite(retryAfterSec)) {
    return backoff;
  }

  return Math.min(Math.max(backoff, Math.ceil(retryAfterSec)), MAX_RETRY_DELAY_SEC);
}

/** The sum of the first `retries` backoff delays. */
export function elapsedBackoffSec(retries: number): number {
  let total = 0;

  for (let retry = 1; retry <= retries; retry += 1) {
    total += retryBackoffSec(retry);
  }

  return total;
}

/** Whether a failure with `code` gets another backoff retry after `retriesSoFar` consecutive ones. */
export function canRetry(code: ErrorCode, retriesSoFar: number, policy: BackupPolicy): boolean {
  switch (errorCatalog[code].retry) {
    case 'none': {
      return false;
    }

    case 'stage': {
      return retriesSoFar < policy.maxStageRetries;
    }

    case 'window': {
      return elapsedBackoffSec(retriesSoFar) < RETRY_WINDOW_SEC;
    }
  }
}

/** In-tick retries of one API call: 0.5 s, 2 s and 8 s, each with ±20 % jitter. */
export const IN_TICK_RETRY_DELAYS_MS = [500, 2000, 8000] as const;

export function inTickRetryDelayMs(retryIndex: number, random: () => number = Math.random): number {
  const base = IN_TICK_RETRY_DELAYS_MS[retryIndex];

  if (base === undefined) {
    throw new RangeError(`Only ${IN_TICK_RETRY_DELAYS_MS.length} in-tick retries are allowed`);
  }

  return Math.round(base * (0.8 + 0.4 * random()));
}
