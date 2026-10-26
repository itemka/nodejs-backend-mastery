import { Client } from '@upstash/qstash';

import type { Scheduler, Wakeup } from '../../application/ports.js';
import type { AppEnv } from '../../config/env.js';
import { PING_JOB_ID } from '../../domain/naming.js';
import type { Logger } from '../../shared/logger.js';

/** QStash's own retries of a failed delivery; business retries are job state. */
export const DELIVERY_RETRIES = 3;

/** The worker's path for one job; QStash signs the full URL, so a message is bound to its job. */
export function workerPath(jobId: string): string {
  return `/api/jobs/process/${encodeURIComponent(jobId)}`;
}

/** The body of a signed `_ping`: the deployment smoke test. */
export interface PingMessage {
  readonly jobId: typeof PING_JOB_ID;
  readonly nonce: string;
}

/** The body of a wakeup. */
export interface WakeupMessage {
  readonly jobId: string;
  readonly reason: Wakeup['reason'];
  readonly token: string;
}

/** The publish request this adapter sends; `@upstash/qstash`'s `Client` accepts it. */
export interface QStashPublishRequest {
  readonly body: PingMessage | WakeupMessage;
  readonly deduplicationId: string;
  readonly delay?: number;
  readonly flowControl: { readonly key: string; readonly parallelism: number };
  readonly retries: number;
  readonly url: string;
}

/** The two QStash calls the app makes; `@upstash/qstash`'s `Client` and test fakes provide them. */
export interface QStashApi {
  readonly messages: { cancel(messageId: string): Promise<unknown> };
  publishJSON(request: QStashPublishRequest): Promise<{ messageId: string }>;
}

export interface QStashConnection {
  /** `QSTASH_URL`: the EU endpoint. */
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * The `@upstash/qstash` client for the EU endpoint. `devMode: false`, or a stray `QSTASH_DEV`
 * would send everything to a local dev server (S3).
 */
export function createQStashClient({ baseUrl, token }: QStashConnection): QStashApi {
  return new Client({ baseUrl, devMode: false, enableTelemetry: false, token });
}

/**
 * A publish or cancel failed. The message is static: an SDK error may quote the request, and
 * QStash's reply never matters beyond its HTTP status.
 */
export class SchedulerError extends Error {
  readonly code = 'SCHEDULER_UNAVAILABLE';

  constructor(operation: 'cancel' | 'publish') {
    super(`QStash ${operation} failed`);
    this.name = 'SchedulerError';
  }
}

export interface QStashSchedulerOptions {
  readonly api: QStashApi;
  /** `APP_BASE_URL`: the destination's origin, which the worker verifies the signature against. */
  readonly appBaseUrl: string;
  /** Names the flow-control key, so each environment's wakeups run one at a time. */
  readonly appEnv: AppEnv;
  readonly logger: Logger;
}

/**
 * `Scheduler` on QStash (EU): a signed POST to `<APP_BASE_URL>/api/jobs/process/<jobId>` after
 * `delaySec`. The deduplication ID `<jobId>.<token>` makes a retried publish deliver once, and
 * flow control runs one delivery per environment at a time.
 */
export class QStashScheduler implements Scheduler {
  private readonly api: QStashApi;
  private readonly appBaseUrl: string;
  private readonly flowControlKey: string;
  private readonly logger: Logger;

  constructor({ api, appBaseUrl, appEnv, logger }: QStashSchedulerOptions) {
    this.api = api;
    this.appBaseUrl = appBaseUrl;
    this.flowControlKey = `nba-${appEnv}`;
    this.logger = logger;
  }

  async cancel(messageId: string): Promise<void> {
    try {
      await this.api.messages.cancel(messageId);
    } catch (error) {
      this.logger.warn('qstash.cancel.failed', failureFields(error));

      throw new SchedulerError('cancel');
    }
  }

  /** The smoke test's signed `_ping`, to the worker's reserved path; the nonce comes back in Redis. */
  async ping(nonce: string): Promise<{ readonly messageId: string }> {
    return this.publish(
      { jobId: PING_JOB_ID, nonce },
      { deduplicationId: `${PING_JOB_ID}.${nonce}` },
    );
  }

  async schedule({ delaySec, jobId, reason, token }: Wakeup): Promise<{ messageId?: string }> {
    return this.publish(
      { jobId, reason, token },
      { deduplicationId: `${jobId}.${token}`, ...(delaySec > 0 ? { delay: delaySec } : {}) },
    );
  }

  private async publish(
    body: PingMessage | WakeupMessage,
    options: { readonly deduplicationId: string; readonly delay?: number },
  ): Promise<{ readonly messageId: string }> {
    try {
      const { messageId } = await this.api.publishJSON({
        body,
        deduplicationId: options.deduplicationId,
        flowControl: { key: this.flowControlKey, parallelism: 1 },
        retries: DELIVERY_RETRIES,
        url: new URL(workerPath(body.jobId), this.appBaseUrl).href,
        ...(options.delay === undefined ? {} : { delay: options.delay }),
      });

      return { messageId };
    } catch (error) {
      this.logger.warn('qstash.publish.failed', { ...failureFields(error), jobId: body.jobId });

      throw new SchedulerError('publish');
    }
  }
}

/** The error's class and HTTP status only: an SDK message may quote QStash's reply. */
function failureFields(error: unknown): { readonly errorName: string; readonly status?: number } {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;

  return {
    errorName: error instanceof Error ? error.name : 'unknown',
    ...(status === undefined ? {} : { status }),
  };
}
