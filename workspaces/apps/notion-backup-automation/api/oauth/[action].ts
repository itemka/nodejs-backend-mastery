import { serveOAuth } from '../../src/config/oauth-containers.js';

/** `/oauth/google/reauth` and `/oauth/google/callback`, rewritten here: the phone re-login. */
export function GET(request: Request): Promise<Response> {
  return serveOAuth(request);
}
