import type { Heartbeat } from '../../application/ports.js';
import type { Logger } from '../../shared/logger.js';
import type { SecretValue } from '../../shared/secret-value.js';

const TIMEOUT_MS = 5000;

export interface HttpHeartbeatOptions {
  readonly fetch?: typeof fetch;
  readonly logger: Logger;
  /** `HEARTBEAT_PING_URL`: anyone holding it can ping the check, so it is never logged. */
  readonly url: SecretValue<string>;
}

/**
 * healthchecks.io: `GET <url>` after a clean cron run, `GET <url>/fail` after a sub-step threw.
 * After a day without a ping, plus a day's grace, healthchecks.io alerts through its own
 * channel, which does not depend on this app. A failed ping is logged and ignored.
 */
export class HttpHeartbeat implements Heartbeat {
  private readonly fetch: typeof fetch;
  private readonly logger: Logger;
  private readonly url: SecretValue<string>;

  constructor({ fetch: fetchImpl = globalThis.fetch, logger, url }: HttpHeartbeatOptions) {
    this.fetch = fetchImpl;
    this.logger = logger;
    this.url = url;
  }

  fail(): Promise<void> {
    return this.ping('fail');
  }

  ok(): Promise<void> {
    return this.ping('ok');
  }

  private async ping(kind: 'fail' | 'ok'): Promise<void> {
    const base = this.url.reveal().replace(/\/+$/, '');

    try {
      const response = await this.fetch(kind === 'fail' ? `${base}/fail` : base, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) {
        this.logger.info('heartbeat.sent', { kind });
      } else {
        this.logger.warn('heartbeat.failed', { kind, status: response.status });
      }
    } catch (error) {
      // The URL is in the request, so the error is reduced to its kind.
      this.logger.warn('heartbeat.failed', {
        kind,
        reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
      });
    }
  }
}

/** `HEARTBEAT_PING_URL` unset: nothing is pinged. */
export class NoopHeartbeat implements Heartbeat {
  fail(): Promise<void> {
    return Promise.resolve();
  }

  ok(): Promise<void> {
    return Promise.resolve();
  }
}
