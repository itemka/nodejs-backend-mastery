import { StateSchemaInvalidError } from '../adapters/persistence/job-codec.js';
import type { SignatureVerifier } from '../adapters/qstash/qstash-signature-verifier.js';
import type { HealthStore } from '../application/ports.js';
import type { ProcessJobUseCase, TickResult } from '../application/process-job.js';
import { ConfigError } from '../config/env.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import { checkDelivery } from './qstash-auth.js';
import {
  configIncomplete,
  errorResponse,
  jsonResponse,
  nonRetryable,
  retryAfter,
  unauthorized,
} from './responses.js';

export interface WorkerHandlerDeps {
  readonly appBaseUrl: string;
  readonly clock: Clock;
  /** Where `_ping` records its nonce. */
  readonly health: Pick<HealthStore, 'write'>;
  readonly logger: Logger;
  /**
   * The tick, built only for a wakeup: it needs the whole backup configuration, which a `_ping`
   * does not. Throws `ConfigError` while that configuration is incomplete.
   */
  readonly processJob: () => Pick<ProcessJobUseCase, 'execute'>;
  readonly verifier: SignatureVerifier;
}

/**
 * `POST /api/jobs/process/[jobId]`: one signed QStash delivery. The response tells QStash what
 * to do next (S3):
 * - 200: done, waiting, a recorded failure, a stale token or an ended job; nothing to retry;
 * - 401: no genuine signature; QStash retries, then gives up;
 * - 489: genuine but impossible (an unknown job, a body that names another job, a record that
 *   fails its schema); straight to the DLQ;
 * - 503 + `Retry-After`: another worker holds the job's lease;
 * - 500: Redis or the next publish failed; QStash retries the same token.
 */
export async function handleWorkerRequest(
  request: Request,
  deps: WorkerHandlerDeps,
): Promise<Response> {
  const { logger } = deps;

  try {
    const check = await checkDelivery(request, deps);

    if (check.outcome === 'unauthorized') {
      logger.warn('worker.unauthorized');

      return unauthorized('INVALID_SIGNATURE');
    }

    if (check.outcome === 'invalid') {
      logger.warn('worker.invalid_message');

      return nonRetryable('INVALID_MESSAGE');
    }

    const { delivery } = check;

    if (delivery.kind === 'ping') {
      await deps.health.write('qstashPing', {
        nonce: delivery.nonce,
        receivedAt: deps.clock.now().toISOString(),
      });
      logger.info('worker.ping');

      return jsonResponse(200, { outcome: 'ping' });
    }

    let useCase: Pick<ProcessJobUseCase, 'execute'>;

    try {
      useCase = deps.processJob();
    } catch (error) {
      if (error instanceof ConfigError) {
        logger.error('worker.config_incomplete', {
          invalid: error.invalid,
          missing: error.missing,
        });

        return configIncomplete();
      }

      throw error;
    }

    return tickResponse(await useCase.execute(delivery.request), logger);
  } catch (error) {
    if (error instanceof StateSchemaInvalidError) {
      logger.error('worker.state_schema_invalid', { record: error.record });

      return nonRetryable(error.code);
    }

    logger.error('worker.failed', { error });

    return errorResponse(500, 'WORKER_FAILED');
  }
}

function tickResponse(result: TickResult, logger: Logger): Response {
  switch (result.outcome) {
    case 'done': {
      return jsonResponse(200, {
        outcome: result.outcome,
        status: result.status,
        step: result.step,
      });
    }

    case 'lease_held': {
      return retryAfter('LEASE_HELD', result.retryAfterSec);
    }

    case 'not_found': {
      logger.warn('worker.job_not_found');

      return nonRetryable('JOB_NOT_FOUND');
    }

    case 'stale': {
      return jsonResponse(200, { outcome: result.outcome });
    }

    case 'terminal': {
      return jsonResponse(200, { outcome: result.outcome, status: result.status });
    }
  }
}
