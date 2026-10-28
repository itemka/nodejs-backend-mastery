import { serveWebhook } from '../src/config/containers.js';

export function POST(request: Request): Promise<Response> {
  return serveWebhook(request);
}

export function GET(request: Request): Promise<Response> {
  return serveWebhook(request);
}
