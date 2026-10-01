import { loadHealthEnv } from '../src/config/env.js';

export interface HealthResponse {
  ok: true;
  version: string;
}

/** Liveness check. Public and unauthenticated, so it returns nothing but `ok` and the short commit SHA. */
export function GET(): Response {
  const { VERCEL_GIT_COMMIT_SHA: commitSha } = loadHealthEnv();
  const body: HealthResponse = { ok: true, version: commitSha?.slice(0, 7) ?? 'unknown' };

  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
