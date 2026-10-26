import { serveCron } from '../../src/config/containers.js';

/** The daily cron, or with `?probe=notion|google|drive` one probe; `Bearer $CRON_SECRET` only. */
export function GET(request: Request): Promise<Response> {
  return serveCron(request);
}
