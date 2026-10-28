import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether `value` is exactly `secret`. Both sides are hashed first, so the comparison takes the
 * same time whatever the value's length or content. A missing value is compared as empty, which
 * never matches: `loadEnv` refuses an empty secret.
 */
export function secretEquals(value: string | null, secret: string): boolean {
  const expected = createHash('sha256').update(secret).digest();
  const actual = createHash('sha256')
    .update(value ?? '')
    .digest();

  return timingSafeEqual(expected, actual);
}

/** Whether `Authorization` is exactly `Bearer <secret>`, compared as `secretEquals` does. */
export function isBearer(header: string | null, secret: string): boolean {
  return secretEquals(header, `Bearer ${secret}`);
}

/**
 * The daily cron and its manual probes: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * by itself, and a manual `curl` sends the same header.
 */
export function isCronRequest(request: Request, cronSecret: string): boolean {
  return isBearer(request.headers.get('authorization'), cronSecret);
}
