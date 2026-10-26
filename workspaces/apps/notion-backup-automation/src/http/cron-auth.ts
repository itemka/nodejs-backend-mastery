import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether `Authorization` is exactly `Bearer <secret>`. Both sides are hashed first, so the
 * comparison takes the same time whatever the header's length or content.
 */
export function isBearer(header: string | null, secret: string): boolean {
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  const actual = createHash('sha256')
    .update(header ?? '')
    .digest();

  return timingSafeEqual(expected, actual);
}

/**
 * The daily cron and its manual probes: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * by itself, and a manual `curl` sends the same header.
 */
export function isCronRequest(request: Request, cronSecret: string): boolean {
  return isBearer(request.headers.get('authorization'), cronSecret);
}
