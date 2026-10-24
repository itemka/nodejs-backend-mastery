import { z } from 'zod';

import { isEncryptionKey } from '../shared/envelope-crypto.js';
import { logLevels } from '../shared/logger.js';

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

/** The EU QStash endpoint (S3, Step 4). Pinned so the SDK default can never drift. */
export const QSTASH_EU_URL = 'https://qstash-eu-central-1.upstash.io';

export const appEnvs = ['prod', 'dev', 'test'] as const;

export type AppEnv = (typeof appEnvs)[number];

const secret = z.string();
const httpsUrl = z.url({ protocol: /^https$/ });
/** An origin such as `https://notion-backup-automation.vercel.app`: no path, query or trailing slash. */
const httpsOrigin = httpsUrl.refine((value) => new URL(value).origin === value);

const flag = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const integer = (min: number, max: number, defaultValue: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

/** `a, b` → `['a', 'b']`; unset → the default list. */
const commaList = <T extends z.ZodType>(item: T, defaultValue: readonly string[]) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== '')
        : (value ?? defaultValue),
    z.array(item),
  );

const timeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });

    return true;
  } catch {
    return false;
  }
});

const coreShape = {
  APP_ENV: z.enum(appEnvs),
  LOG_LEVEL: z.enum(logLevels).default('info'),
};

const redisShape = {
  UPSTASH_REDIS_REST_TOKEN: secret,
  UPSTASH_REDIS_REST_URL: httpsUrl,
};

/** The domain limits; see `BackupPolicy`. */
const policyShape = {
  BACKUP_TIME_ZONE: timeZone.default('Europe/Warsaw'),
  EMAIL_WAIT_TIMEOUT_HOURS: integer(1, 168, 48),
  JOB_MAX_LIFETIME_HOURS: integer(24, 720, 168),
  MAX_EXPORT_ATTEMPTS: integer(1, 5, 3),
  MAX_STAGE_RETRIES: integer(0, 10, 3),
};

/** Publishing wakeups. `APP_BASE_URL` + path is the destination that QStash signs. */
const qstashPublishShape = {
  APP_BASE_URL: httpsOrigin,
  QSTASH_TOKEN: secret,
  QSTASH_URL: httpsUrl.default(QSTASH_EU_URL),
};

const qstashVerifyShape = {
  QSTASH_CURRENT_SIGNING_KEY: secret,
  QSTASH_NEXT_SIGNING_KEY: secret,
};

const googleClientShape = {
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: secret,
};

const googleApiShape = {
  ...googleClientShape,
  GOOGLE_REFRESH_TOKEN: secret,
};

/** The folder ID is interpolated into Drive queries, so it is limited to ID characters. */
const driveShape = {
  GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: z.string().regex(/^[\w-]+$/),
};

const googleShape = { ...googleApiShape, ...driveShape };

/** `markdown` is Notion's "Markdown & CSV", the format of the manual backups (Phase 0). */
export const notionExportFormats = ['markdown'] as const;

export type NotionExportFormat = (typeof notionExportFormats)[number];

const notionShape = {
  NOTION_EXPORT_FORMAT: z.enum(notionExportFormats).default('markdown'),
  NOTION_WORKSPACE_NAME: z.string(),
  NOTION_WORKSPACE_URL: httpsUrl,
};

const encryptionShape = {
  APP_ENCRYPTION_KEY: secret.refine(isEncryptionKey),
};

/** `GEMINI_API_KEY` is optional here; the worker and cron schemas require it for `gemini`. */
const agentShape = {
  AGENT_MAX_DECISIONS_PER_DAY: integer(1, 100, 20),
  AGENT_MAX_DECISIONS_PER_INCIDENT: integer(1, 10, 4),
  AGENT_MAX_INCIDENTS_PER_JOB: integer(1, 10, 3),
  AGENT_MODEL_NAME: z.string().default('gemini-2.5-flash'),
  AGENT_MODEL_PROVIDER: z.enum(['gemini', 'none']).default('gemini'),
  AGENT_TIMEOUT_MS: integer(1000, 60_000, 20_000),
  GEMINI_API_KEY: secret.optional(),
};

const transferShape = {
  NOTIFIERS: commaList(z.enum(['console']), ['console']),
  // Only the tmp transfer exists (S4: a 250 MiB ZIP fits), so `stream` fails the config check.
  TRANSFER_MODE: z.enum(['tmp']).default('tmp'),
  WRITE_SHA256_SIDECAR: flag(true),
};

const requireGeminiKey = (
  env: { AGENT_MODEL_PROVIDER: string; GEMINI_API_KEY?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (env.AGENT_MODEL_PROVIDER === 'gemini' && env.GEMINI_API_KEY === undefined) {
    context.addIssue({ code: 'custom', message: 'Required', path: ['GEMINI_API_KEY'] });
  }
};

/** Redis access only: `test:live` and local CLI commands. */
export const persistenceEnvSchema = z.object({ ...coreShape, ...redisShape });

/** The encrypted secrets in Redis: `doctor`. */
export const secretStoreEnvSchema = z.object({ ...coreShape, ...redisShape, ...encryptionShape });

/** `auth:notion` and `dev:trigger`: the Notion session in Redis and the workspace it signs in to. */
export const notionBrowserEnvSchema = z.object({
  ...coreShape,
  ...redisShape,
  ...encryptionShape,
  ...notionShape,
});

/**
 * `dev:download`: the newest export email's ZIP, fetched with the Notion session's cookies. The
 * time zone dates the email search.
 */
export const devDownloadEnvSchema = z.object({
  ...coreShape,
  ...redisShape,
  ...encryptionShape,
  ...googleApiShape,
  BACKUP_TIME_ZONE: policyShape.BACKUP_TIME_ZONE,
});

/**
 * `auth:google`: the OAuth client, since it produces the refresh token. The time zone dates the
 * 1Password label.
 */
export const googleAuthEnvSchema = z.object({
  ...googleClientShape,
  BACKUP_TIME_ZONE: policyShape.BACKUP_TIME_ZONE,
});

/** `auth:google --pick-folders`: the picked items are checked against the configured root. */
export const googlePickerEnvSchema = z.object({ ...googleClientShape, ...driveShape });

/** Gmail and Drive API calls from the CLI: `doctor`, `drive:init`. The time zone dates searches. */
export const googleApiEnvSchema = z.object({
  ...googleApiShape,
  BACKUP_TIME_ZONE: policyShape.BACKUP_TIME_ZONE,
});

/** `drive:check`, `drive:init` and `test:live:drive`. The time zone picks the year folder. */
export const driveEnvSchema = z.object({
  ...googleApiShape,
  ...driveShape,
  BACKUP_TIME_ZONE: policyShape.BACKUP_TIME_ZONE,
});

/**
 * `dev:upload`: uploads under `_dev` when `APP_ENV=dev`. The time zone names the file and picks
 * the year folder.
 */
export const devUploadEnvSchema = z.object({
  ...googleApiShape,
  ...driveShape,
  APP_ENV: coreShape.APP_ENV,
  BACKUP_TIME_ZONE: policyShape.BACKUP_TIME_ZONE,
  WRITE_SHA256_SIDECAR: transferShape.WRITE_SHA256_SIDECAR,
});

/** `/mcp`: starts and inspects jobs. It never needs Gemini, the QStash signing keys or Google. */
export const mcpEnvSchema = z.object({
  ...coreShape,
  ...redisShape,
  ...policyShape,
  ...qstashPublishShape,
  ...agentShape,
  AUTO_START_ENABLED: flag(false),
  MCP_ALLOWED_ORIGINS: commaList(httpsOrigin, []),
  MCP_AUTH_TOKEN: secret,
});

const workerShape = {
  ...coreShape,
  ...redisShape,
  ...policyShape,
  ...qstashPublishShape,
  ...qstashVerifyShape,
  ...googleShape,
  ...notionShape,
  ...encryptionShape,
  ...agentShape,
  ...transferShape,
};

/** `/api/jobs/process/[jobId]`: one tick of one job. */
export const workerEnvSchema = z.object(workerShape).superRefine(requireGeminiKey);

/** `/api/cron/daily`: the worker's needs plus the cron secret and the auto-start settings. */
export const cronEnvSchema = z
  .object({
    ...workerShape,
    AUTO_START_ENABLED: flag(false),
    BACKUP_DAY_OF_MONTH: integer(1, 28, 1),
    CRON_SECRET: secret,
  })
  .superRefine(requireGeminiKey);

export type PersistenceEnv = z.output<typeof persistenceEnvSchema>;
export type McpEnv = z.output<typeof mcpEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type CronEnv = z.output<typeof cronEnvSchema>;

const byName = (a: string, b: string) => a.localeCompare(b);

/** `CONFIG_INCOMPLETE`. The message names the variables, never their values. */
export class ConfigError extends Error {
  readonly code = 'CONFIG_INCOMPLETE';
  readonly invalid: readonly string[];
  readonly missing: readonly string[];

  constructor(missing: readonly string[], invalid: readonly string[]) {
    const parts = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      invalid.length > 0 ? `invalid ${invalid.join(', ')}` : '',
    ].filter((part) => part !== '');

    super(`Configuration incomplete: ${parts.join('; ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
    this.invalid = invalid;
  }
}

/**
 * Parses one function's env subset. Only the schema's own variables are read, and an empty
 * value counts as missing (`.env.example` and `process.loadEnvFile` produce empty strings).
 */
export function loadEnv<T extends z.ZodObject>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.output<T> {
  const input: Record<string, string> = {};

  for (const name of Object.keys(schema.shape)) {
    const value = source[name];

    if (value !== undefined && value !== '') {
      input[name] = value;
    }
  }

  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const missing = new Set<string>();
  const invalid = new Set<string>();

  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? '(root)');

    (input[name] === undefined ? missing : invalid).add(name);
  }

  throw new ConfigError([...missing].toSorted(byName), [...invalid].toSorted(byName));
}
