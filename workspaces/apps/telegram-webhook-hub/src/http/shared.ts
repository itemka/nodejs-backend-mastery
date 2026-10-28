import { createHash, timingSafeEqual } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

export function secretEquals(actual: string | null, expected: string): boolean {
  if (actual === null || expected === '') {
    return false;
  }

  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

/** A refusal that a resend cannot change: any 4xx except 408 (timeout) and 429 (rate limit). */
export function isPermanentRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function json(
  status: number,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
): Response {
  return Response.json(body, { headers: { 'cache-control': 'no-store', ...headers }, status });
}

/** Bound the stream before parsing, including bodies without Content-Length. */
export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;

  if (reader === undefined) {
    return undefined;
  }

  let size = 0;
  const chunks: Uint8Array[] = [];

  try {
    for (;;) {
      const next = await reader.read();

      if (next.done) {
        break;
      }

      size += next.value.byteLength;

      if (size > 64 * 1024) {
        await reader.cancel();

        return undefined;
      }

      chunks.push(next.value);
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}
