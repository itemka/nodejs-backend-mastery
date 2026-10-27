import { createHash, createHmac, randomUUID } from 'node:crypto';

import type {
  QStashApi,
  QStashPublishRequest,
} from '../../src/adapters/qstash/qstash-scheduler.js';

/** Test signing keys; QStash never issued them. */
export const TEST_SIGNING_KEYS = {
  current: 'sig_current_0123456789abcdefghijklmn',
  next: 'sig_next_0123456789abcdefghijklmnopqr',
} as const;

export const TEST_BASE_URL = 'https://nba.example.vercel.app';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export interface SignOptions {
  /** Seconds from now; negative for an expired token. Default 300. */
  readonly expiresInSec?: number;
  readonly issuer?: string;
  readonly nowSec?: number;
}

/**
 * A token in the shape of QStash's `Upstash-Signature` (S3): HS256, `iss: "Upstash"`, `sub` =
 * the destination URL, `body` = base64url(SHA-256(raw body)).
 */
export function signLikeQStash(
  key: string,
  claims: { readonly body: string; readonly url: string },
  {
    expiresInSec = 300,
    issuer = 'Upstash',
    nowSec = Math.floor(Date.now() / 1000),
  }: SignOptions = {},
): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    body: createHash('sha256').update(claims.body).digest('base64url'),
    exp: nowSec + expiresInSec,
    iat: nowSec,
    iss: issuer,
    jti: randomUUID(),
    nbf: Math.min(nowSec, nowSec + expiresInSec),
    sub: claims.url,
  });
  const signature = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/** A signed POST to the worker, as QStash sends it. */
export function signedDelivery(
  path: string,
  body: unknown,
  options: SignOptions & { readonly key?: string; readonly signedUrl?: string } = {},
): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const url = new URL(path, TEST_BASE_URL).href;
  const signature = signLikeQStash(
    options.key ?? TEST_SIGNING_KEYS.current,
    { body: text, url: options.signedUrl ?? url },
    options,
  );

  return new Request(url, {
    body: text,
    headers: { 'content-type': 'application/json', 'upstash-signature': signature },
    method: 'POST',
  });
}

/** QStash's publish API in memory: every request is recorded; `failures` makes the next ones throw. */
export class FakeQStashApi implements QStashApi {
  readonly cancelled: string[] = [];
  failures = 0;
  readonly messages = {
    cancel: (messageId: string): Promise<unknown> => {
      this.cancelled.push(messageId);

      return Promise.resolve({ cancelled: 1 });
    },
  };
  /** Runs after a publish is recorded, as QStash delivering it. */
  onPublish: ((request: QStashPublishRequest) => Promise<void>) | undefined;
  readonly published: QStashPublishRequest[] = [];

  async publishJSON(request: QStashPublishRequest): Promise<{ messageId: string }> {
    if (this.failures > 0) {
      this.failures -= 1;

      throw new Error('QStash returned 500: {"error":"internal","token":"eyJsecret"}');
    }

    this.published.push(request);
    await this.onPublish?.(request);

    return { messageId: `msg_${this.published.length}` };
  }
}
