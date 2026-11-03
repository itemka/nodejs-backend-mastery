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

const BEARER_SCHEME = 'bearer ';

/**
 * Whether `Authorization` is `Bearer <secret>`, the token compared as `secretEquals` does. The
 * scheme is case-insensitive (RFC 9110, section 11.1); the token is not.
 */
export function isBearer(header: string | null, secret: string): boolean {
  const token =
    header?.slice(0, BEARER_SCHEME.length).toLowerCase() === BEARER_SCHEME
      ? header.slice(BEARER_SCHEME.length)
      : '';

  return secretEquals(token, secret);
}

/**
 * The daily cron and its manual probes: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * by itself, and a manual `curl` sends the same header.
 */
export function isCronRequest(request: Request, cronSecret: string): boolean {
  return isBearer(request.headers.get('authorization'), cronSecret);
}
