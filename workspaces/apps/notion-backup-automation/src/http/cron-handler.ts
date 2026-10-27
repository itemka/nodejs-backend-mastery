import type { DailyMaintenance } from '../application/daily-maintenance.js';
import { isProbeName, probeNames } from '../application/daily-maintenance.js';
import { ConfigError } from '../config/env.js';
import type { Logger } from '../shared/logger.js';
import { isCronRequest } from './cron-auth.js';
import { configIncomplete, errorResponse, jsonResponse } from './responses.js';

export interface CronHandlerDeps {
  readonly cronSecret: string;
  readonly logger: Logger;
  /** Built only for an authenticated call; throws `ConfigError` while the configuration is incomplete. */
  readonly maintenance: () => Pick<DailyMaintenance, 'probe' | 'run'>;
}

/**
 * `GET /api/cron/daily`, with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it). Plain,
 * it runs the daily routine: 200 when every sub-step ran, 500 when one threw (the report names
 * it). With `?probe=notion|google|drive`, it runs only that probe and returns its sanitized
 * result. Bodies hold codes, statuses and dates only.
 */
export async function handleCronRequest(
  request: Request,
  deps: CronHandlerDeps,
): Promise<Response> {
  const { logger } = deps;

  if (!isCronRequest(request, deps.cronSecret)) {
    logger.warn('cron.unauthorized');

    return errorResponse(401, 'UNAUTHORIZED', { 'WWW-Authenticate': 'Bearer' });
  }

  const probe = new URL(request.url).searchParams.get('probe');

  if (probe !== null && !isProbeName(probe)) {
    return jsonResponse(400, { error: 'INVALID_PROBE', probes: probeNames });
  }

  let maintenance: Pick<DailyMaintenance, 'probe' | 'run'>;

  try {
    maintenance = deps.maintenance();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('cron.config_incomplete', { invalid: error.invalid, missing: error.missing });

      return configIncomplete();
    }

    throw error;
  }

  try {
    if (probe !== null) {
      return jsonResponse(200, await maintenance.probe(probe));
    }

    const report = await maintenance.run();

    return jsonResponse(report.ok ? 200 : 500, report);
  } catch (error) {
    logger.error('cron.failed', { error });

    return errorResponse(500, 'CRON_FAILED');
  }
}
