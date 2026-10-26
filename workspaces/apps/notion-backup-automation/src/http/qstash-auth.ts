import { z } from 'zod';

import type { SignatureVerifier } from '../adapters/qstash/qstash-signature-verifier.js';
import { wakeupReasons } from '../application/ports.js';
import type { TickRequest } from '../application/process-job.js';
import { jobIdSchema, PING_JOB_ID } from '../domain/naming.js';

const WORKER_PATH = /^\/api\/jobs\/process\/([^/]+)$/;

/** The two bodies the app publishes; anything else, extra keys included, is refused. */
export const workerMessageSchema = z.union([
  z.strictObject({ jobId: z.literal(PING_JOB_ID), nonce: z.string().regex(/^[\w-]{8,64}$/) }),
  z.strictObject({
    jobId: jobIdSchema,
    reason: z.enum(wakeupReasons),
    token: z.string().regex(/^[\w-]{16,64}$/),
  }),
]);

export type WorkerDelivery =
  | { readonly kind: 'ping'; readonly nonce: string }
  | { readonly kind: 'tick'; readonly request: TickRequest };

/**
 * - `unauthorized`: no genuine QStash signature for this URL and body;
 * - `invalid`: genuine, but the body is not one the app publishes, or names another job than the
 *   path. It can never succeed, so the worker answers 489;
 * - `ok`: a ping or a wakeup of the path's job.
 */
export type DeliveryCheck =
  | { readonly delivery: WorkerDelivery; readonly outcome: 'ok' }
  | { readonly outcome: 'invalid' }
  | { readonly outcome: 'unauthorized' };

export interface DeliveryCheckOptions {
  /** `APP_BASE_URL`: the signature is checked against it plus the path, never the Host header. */
  readonly appBaseUrl: string;
  readonly verifier: SignatureVerifier;
}

/**
 * Verifies a QStash delivery against its raw body and its URL: `APP_BASE_URL` plus the request's
 * path. The app never publishes a query string, and the signature binds the full URL (S3), so
 * a query fails the check. Only then is the body parsed.
 */
export async function checkDelivery(
  request: Request,
  { appBaseUrl, verifier }: DeliveryCheckOptions,
): Promise<DeliveryCheck> {
  const body = await request.text();
  const { pathname, search } = new URL(request.url);
  const genuine = await verifier.verify({
    body,
    signature: request.headers.get('upstash-signature') ?? '',
    url: new URL(`${pathname}${search}`, appBaseUrl).href,
  });

  if (!genuine) {
    return { outcome: 'unauthorized' };
  }

  const message = workerMessageSchema.safeParse(parseJson(body));

  if (!message.success || message.data.jobId !== jobIdOfPath(pathname)) {
    return { outcome: 'invalid' };
  }

  const { data } = message;

  return {
    delivery:
      'nonce' in data
        ? { kind: 'ping', nonce: data.nonce }
        : { kind: 'tick', request: { jobId: data.jobId, reason: data.reason, token: data.token } },
    outcome: 'ok',
  };
}

function jobIdOfPath(pathname: string): string | undefined {
  const segment = WORKER_PATH.exec(pathname)?.[1];

  if (segment === undefined) {
    return undefined;
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
