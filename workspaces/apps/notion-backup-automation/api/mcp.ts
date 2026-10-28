import { serveMcp } from '../src/config/control-containers.js';

/** The remote MCP server (`/mcp` is rewritten here); `Bearer $MCP_AUTH_TOKEN` only. */
export function POST(request: Request): Promise<Response> {
  return serveMcp(request);
}

/** Answered by the handler too: 401 without the token, else 405, since `/mcp` is stateless. */
export function GET(request: Request): Promise<Response> {
  return serveMcp(request);
}

export function DELETE(request: Request): Promise<Response> {
  return serveMcp(request);
}
