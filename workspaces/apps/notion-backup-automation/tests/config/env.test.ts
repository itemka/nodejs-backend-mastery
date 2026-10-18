import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigError,
  cronEnvSchema,
  driveEnvSchema,
  googleApiEnvSchema,
  googleAuthEnvSchema,
  googlePickerEnvSchema,
  loadEnv,
  loadHealthEnv,
  mcpEnvSchema,
  persistenceEnvSchema,
  QSTASH_EU_URL,
  secretStoreEnvSchema,
  workerEnvSchema,
} from '../../src/config/env.js';

const commitSha = '0123456789abcdef0123456789abcdef01234567';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

describe('loadHealthEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the commit SHA that Vercel sets for Git deployments', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', commitSha);

    expect(loadHealthEnv()).toEqual({ VERCEL_GIT_COMMIT_SHA: commitSha });
  });

  it('treats a missing SHA as unknown', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- vi.stubEnv requires the value; undefined unsets the variable
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);

    expect(loadHealthEnv().VERCEL_GIT_COMMIT_SHA).toBeUndefined();
  });

  it.each(['', 'abc1234', 'not-a-sha', commitSha.toUpperCase()])(
    'treats %j as unknown instead of failing',
    (value) => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', value);

      expect(loadHealthEnv().VERCEL_GIT_COMMIT_SHA).toBeUndefined();
    },
  );
});

const persistenceVars = {
  APP_ENV: 'prod',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token-value-1234',
  UPSTASH_REDIS_REST_URL: 'https://eu1-example.upstash.io',
};

const mcpVars = {
  ...persistenceVars,
  APP_BASE_URL: 'https://notion-backup-automation.vercel.app',
  MCP_AUTH_TOKEN: 'mcp-token-value-1234',
  QSTASH_TOKEN: 'qstash-token-value-1234',
};

const workerVars = {
  ...mcpVars,
  APP_ENCRYPTION_KEY: encryptionKey,
  GEMINI_API_KEY: 'gemini-key-value-1234',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-secret-value-1234',
  GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: '1AbCdEfGhIjKlMnOp_q-r',
  GOOGLE_REFRESH_TOKEN: 'refresh-token-value-1234',
  NOTION_WORKSPACE_NAME: 'Example Workspace',
  NOTION_WORKSPACE_URL: 'https://app.notion.com/p/Dashboard-0123456789abcdef0123456789abcdef',
  QSTASH_CURRENT_SIGNING_KEY: 'sig_current_value_1234',
  QSTASH_NEXT_SIGNING_KEY: 'sig_next_value_1234',
};

const cronVars = { ...workerVars, CRON_SECRET: 'cron-secret-value-1234' };

function configError(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected a ConfigError');
}

describe('loadEnv', () => {
  it('applies the documented defaults', () => {
    const env = loadEnv(cronEnvSchema, cronVars);

    expect(env).toMatchObject({
      AGENT_MAX_DECISIONS_PER_DAY: 20,
      AGENT_MAX_DECISIONS_PER_INCIDENT: 4,
      AGENT_MAX_INCIDENTS_PER_JOB: 3,
      AGENT_MODEL_NAME: 'gemini-2.5-flash',
      AGENT_MODEL_PROVIDER: 'gemini',
      AGENT_TIMEOUT_MS: 20_000,
      AUTO_START_ENABLED: false,
      BACKUP_DAY_OF_MONTH: 1,
      BACKUP_TIME_ZONE: 'Europe/Warsaw',
      EMAIL_WAIT_TIMEOUT_HOURS: 48,
      JOB_MAX_LIFETIME_HOURS: 168,
      LOG_LEVEL: 'info',
      MAX_EXPORT_ATTEMPTS: 3,
      MAX_STAGE_RETRIES: 3,
      NOTIFIERS: ['console'],
      NOTION_EXPORT_FORMAT: 'markdown',
      QSTASH_URL: QSTASH_EU_URL,
      TRANSFER_MODE: 'tmp',
      WRITE_SHA256_SIDECAR: true,
    });
  });

  it('parses numbers, flags and lists', () => {
    const env = loadEnv(mcpEnvSchema, {
      ...mcpVars,
      AUTO_START_ENABLED: 'true',
      MAX_EXPORT_ATTEMPTS: '2',
      MCP_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
    });

    expect(env.AUTO_START_ENABLED).toBe(true);
    expect(env.MAX_EXPORT_ATTEMPTS).toBe(2);
    expect(env.MCP_ALLOWED_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('reads only the variables of the schema', () => {
    const env = loadEnv(persistenceEnvSchema, { ...persistenceVars, QSTASH_TOKEN: 'unrelated' });

    expect(Object.keys(env).toSorted()).toEqual([
      'APP_ENV',
      'LOG_LEVEL',
      'UPSTASH_REDIS_REST_TOKEN',
      'UPSTASH_REDIS_REST_URL',
    ]);
  });

  it('does not require Gemini, the QStash signing keys or Google for /mcp', () => {
    expect(() => loadEnv(mcpEnvSchema, mcpVars)).not.toThrow();
  });

  it('requires GEMINI_API_KEY in the worker only while the provider is gemini', () => {
    const { GEMINI_API_KEY: _key, ...withoutKey } = workerVars;

    expect(configError(() => loadEnv(workerEnvSchema, withoutKey)).missing).toEqual([
      'GEMINI_API_KEY',
    ]);
    expect(() =>
      loadEnv(workerEnvSchema, { ...withoutKey, AGENT_MODEL_PROVIDER: 'none' }),
    ).not.toThrow();
  });

  it('names missing variables, and treats an empty value as missing', () => {
    const error = configError(() =>
      loadEnv(cronEnvSchema, { ...cronVars, APP_ENCRYPTION_KEY: '', CRON_SECRET: undefined }),
    );

    expect(error.code).toBe('CONFIG_INCOMPLETE');
    expect(error.missing).toEqual(['APP_ENCRYPTION_KEY', 'CRON_SECRET']);
    expect(error.invalid).toEqual([]);
    expect(error.message).toBe('Configuration incomplete: missing APP_ENCRYPTION_KEY, CRON_SECRET');
  });

  it('names malformed variables without ever printing a value', () => {
    const leakedValues = {
      APP_BASE_URL: 'https://leaked-host.example.com/with/path',
      // Built at run time: a base64 literal in a `KEY:` field trips secret scanners.
      APP_ENCRYPTION_KEY: Buffer.from('not-32-bytes-long').toString('base64'),
      AUTO_START_ENABLED: 'leaked-yes',
      BACKUP_TIME_ZONE: 'Leaked/Zone',
      LOG_LEVEL: 'leaked-level',
      MAX_EXPORT_ATTEMPTS: '99',
      NOTION_WORKSPACE_URL: 'http://leaked-insecure.example.com',
    };
    const error = configError(() => loadEnv(cronEnvSchema, { ...cronVars, ...leakedValues }));

    expect(error.invalid).toEqual(Object.keys(leakedValues).toSorted());
    expect(error.missing).toEqual([]);

    for (const value of Object.values(leakedValues)) {
      expect(error.message).not.toContain(value);
      expect(JSON.stringify(error)).not.toContain(value);
    }
  });

  it.each([
    ['31 bytes', Buffer.alloc(31, 1).toString('base64')],
    ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['base64url characters', Buffer.alloc(32, 255).toString('base64url')],
    ['no padding', encryptionKey.slice(0, -1)],
  ])('rejects an APP_ENCRYPTION_KEY with %s', (_case, value) => {
    expect(
      configError(() => loadEnv(workerEnvSchema, { ...workerVars, APP_ENCRYPTION_KEY: value }))
        .invalid,
    ).toEqual(['APP_ENCRYPTION_KEY']);
  });

  it.each([
    'https://notion-backup-automation.vercel.app/',
    'https://notion-backup-automation.vercel.app/mcp',
    'http://notion-backup-automation.vercel.app',
  ])('rejects APP_BASE_URL %s: it must be an https origin', (value) => {
    expect(
      configError(() => loadEnv(mcpEnvSchema, { ...mcpVars, APP_BASE_URL: value })).invalid,
    ).toEqual(['APP_BASE_URL']);
  });

  it('rejects an unknown APP_ENV instead of defaulting to prod', () => {
    expect(
      configError(() => loadEnv(mcpEnvSchema, { ...mcpVars, APP_ENV: 'staging' })).invalid,
    ).toEqual(['APP_ENV']);
    expect(
      configError(() => loadEnv(mcpEnvSchema, { ...mcpVars, APP_ENV: undefined })).missing,
    ).toEqual(['APP_ENV']);
  });
});

describe('CLI env subsets', () => {
  it('auth:google needs the OAuth client only; the time zone has a default', () => {
    expect(configError(() => loadEnv(googleAuthEnvSchema, {})).missing).toEqual([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]);
    expect(loadEnv(googleAuthEnvSchema, workerVars).BACKUP_TIME_ZONE).toBe('Europe/Warsaw');
  });

  it('doctor needs the refresh token for Gmail, and the Picker needs the root', () => {
    expect(configError(() => loadEnv(googleApiEnvSchema, {})).missing).toEqual([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
    ]);
    expect(configError(() => loadEnv(googlePickerEnvSchema, {})).missing).toEqual([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID',
    ]);
  });

  it('drive:check takes the backup time zone with its default', () => {
    expect(loadEnv(driveEnvSchema, workerVars).BACKUP_TIME_ZONE).toBe('Europe/Warsaw');
  });

  it('rejects a root folder ID that could break out of a Drive query', () => {
    expect(
      configError(() =>
        loadEnv(driveEnvSchema, {
          ...workerVars,
          GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID: "root' or 'x' in parents",
        }),
      ).invalid,
    ).toEqual(['GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID']);
  });

  it('the secret store needs Redis and the encryption key', () => {
    expect(configError(() => loadEnv(secretStoreEnvSchema, persistenceVars)).missing).toEqual([
      'APP_ENCRYPTION_KEY',
    ]);
  });
});
