import { setTimeout as sleepFor } from 'node:timers/promises';

/** Waits `ms`. The signal, when given, may end the wait early. Tests replace it. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Node's timer; an abort cancels it. */
export const systemSleep: Sleep = (ms, signal) =>
  sleepFor(ms, undefined, signal === undefined ? {} : { signal });

/**
 * Waits `ms` unless `signal` aborts, which ends the wait at once with the signal's reason, as
 * `fetch` and `AbortSignal.throwIfAborted` report it.
 */
export async function pause(
  sleep: Sleep,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  signal?.throwIfAborted();

  try {
    await sleep(ms, signal);
  } catch (error) {
    signal?.throwIfAborted();

    throw error;
  }

  signal?.throwIfAborted();
}
