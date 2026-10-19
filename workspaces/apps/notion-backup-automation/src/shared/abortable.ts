/**
 * Settles like `promise`, or rejects with the signal's reason as soon as it aborts. The work
 * behind `promise` keeps running: this is for work that cannot take a signal itself, such as
 * waiting for the next piece of a stream.
 */
export async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason as Error);
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    // The race keeps a handler on `promise`, so a rejection after the abort is never unhandled.
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
