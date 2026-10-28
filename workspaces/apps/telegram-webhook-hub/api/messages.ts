import { serveMessages } from '../src/config/containers.js';

export function POST(request: Request): Promise<Response> {
  return serveMessages(request);
}

export function GET(request: Request): Promise<Response> {
  return serveMessages(request);
}
