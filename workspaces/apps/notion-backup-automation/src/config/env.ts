import { z } from 'zod';

const gitCommitShaPattern = /^[0-9a-f]{40}$/;

/**
 * Env subset for `api/health.ts`. It reads only Vercel system variables, so it never fails:
 * the health check must answer even when the app's own configuration is incomplete.
 */
export const healthEnvSchema = z.object({
  // Set by Vercel for Git deployments. Unset, empty or malformed (local runs, CLI deploys) → undefined.
  VERCEL_GIT_COMMIT_SHA: z
    .string()
    .optional()
    .transform((sha) => (sha !== undefined && gitCommitShaPattern.test(sha) ? sha : undefined)),
});

export type HealthEnv = z.infer<typeof healthEnvSchema>;

export function loadHealthEnv(): HealthEnv {
  return healthEnvSchema.parse(process.env);
}
