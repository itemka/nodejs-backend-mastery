import type { Sleep } from './sleep.js';
import { pause } from './sleep.js';

/** In-tick retries wait at most this long; a longer `Retry-After` is left to the job's backoff. */
export const MAX_IN_TICK_DELAY_SEC = 10;

/** An error that may carry the failed call's `Retry-After`, in seconds. */
export type RetryableError = Error & { readonly retryAfterSec: number | undefined };

/**
 * What an attempt returns when another attempt may succeed: a network error, a timeout, 429 or
 * 5xx. Anything an attempt throws ends the retries at once.
 */
export class TransientFailure {
  readonly error: RetryableError;

  constructor(error: RetryableError) {
    this.error = error;
  }
}

export interface RetryOptions {
  /** Attempts in all, the first included. */
  readonly attempts: number;
  /** Called before the wait for the next attempt. */
  readonly onRetry?: (error: RetryableError, attempt: number) => void;
  /** Ends the waits and further attempts; the call then rejects with the signal's reason. */
  readonly signal?: AbortSignal | undefined;
  readonly sleep: Sleep;
}

/**
 * Runs `attempt` again after a `TransientFailure`, waiting its `Retry-After` or else
 * `backoffMs`. The failure's error is thrown once no attempt is left, or when the wait would
 * exceed `MAX_IN_TICK_DELAY_SEC`.
 */
export async function retryTransient<T>(
  attempt: () => Promise<T | TransientFailure>,
  { attempts, onRetry, signal, sleep }: RetryOptions,
): Promise<T> {
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    signal?.throwIfAborted();

    const result = await attempt();

    if (!(result instanceof TransientFailure)) {
      return result;
    }

    const { error } = result;
    const delaySec = error.retryAfterSec ?? backoffMs(attemptNumber) / 1000;

    if (attemptNumber >= attempts || delaySec > MAX_IN_TICK_DELAY_SEC) {
      throw error;
    }

    onRetry?.(error, attemptNumber);
    await pause(sleep, delaySec * 1000, signal);
  }
}

/** 0.5 s, 1 s, 2 s, … */
export function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1);
}

/** `Retry-After` as seconds or an HTTP date; undefined when absent or unreadable. */
export function parseRetryAfter(value: null | string, nowMs: number): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }

  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  const date = Date.parse(value);

  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - nowMs) / 1000));
}
