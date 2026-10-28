import { serveTelegramIntegration } from '../../src/config/control-containers.js';

/** Normalized commands from telegram-webhook-hub; integration bearer token required. */
export function POST(request: Request): Promise<Response> {
  return serveTelegramIntegration(request);
}
