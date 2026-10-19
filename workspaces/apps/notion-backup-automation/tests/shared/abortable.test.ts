import { describe, expect, it } from 'vitest';

import { abortable } from '../../src/shared/abortable.js';

/** A promise that never settles, like a read from a stalled stream. */
function stalled(): Promise<never> {
  return new Promise<never>(() => {
    // Never settles.
  });
}

describe('abortable', () => {
  it('settles like the promise when the signal does not abort', async () => {
    const controller = new AbortController();

    await expect(abortable(Promise.resolve(42), controller.signal)).resolves.toBe(42);
    await expect(
      abortable(Promise.reject(new Error('read failed')), controller.signal),
    ).rejects.toThrow('read failed');
  });

  it('rejects with the signal’s reason as soon as it aborts, while the promise still waits', async () => {
    const controller = new AbortController();
    const waiting = abortable(stalled(), controller.signal);

    controller.abort(new Error('transfer budget exceeded'));

    await expect(waiting).rejects.toThrow('transfer budget exceeded');
  });

  it('rejects at once when the signal has already aborted', async () => {
    await expect(abortable(stalled(), AbortSignal.abort(new Error('cancelled')))).rejects.toThrow(
      'cancelled',
    );
  });

  it('settles like the promise without a signal', async () => {
    await expect(abortable(Promise.resolve('bytes'))).resolves.toBe('bytes');
  });
});
