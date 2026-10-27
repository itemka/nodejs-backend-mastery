import { serveWorker } from '../../../src/config/containers.js';

/** The QStash worker: one signed delivery, one tick of one job, or the `_ping` smoke test. */
export function POST(request: Request): Promise<Response> {
  return serveWorker(request);
}
