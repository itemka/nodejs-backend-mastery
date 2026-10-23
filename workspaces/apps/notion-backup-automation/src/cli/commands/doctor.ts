import * as ui from '@workspaces/cli-output';

import { checkDriveRoot } from '../../adapters/drive/drive-access-check.js';
import { EXPORT_EMAIL } from '../../adapters/gmail/export-email-parser.js';
import { GmailApi } from '../../adapters/gmail/gmail-api.js';
import { GmailExportEmailFinder } from '../../adapters/gmail/gmail-export-email-finder.js';
import { shortScope } from '../../adapters/google/oauth-client.js';
import type { OAuthTokenProvider } from '../../adapters/google/token-provider.js';
import { keyPrefixFor } from '../../adapters/persistence/keys.js';
import { RedisSecretStore } from '../../adapters/persistence/redis-secret-store.js';
import { IntegrationError } from '../../application/integration-error.js';
import {
  ConfigError,
  driveEnvSchema,
  googleApiEnvSchema,
  loadEnv,
  persistenceEnvSchema,
  secretStoreEnvSchema,
} from '../../config/env.js';
import { localDateFor, startOfLocalDay } from '../../domain/period.js';
import { createEnvelopeKey, EnvelopeError } from '../../shared/envelope-crypto.js';
import { maskEmail } from '../../shared/mask.js';
import type { CliContext } from '../context.js';
import { createGoogleApi, createTokenProvider } from '../context.js';

type Status = 'fail' | 'ok' | 'skip' | 'warn';

interface CheckResult {
  detail: string;
  name: string;
  status: Status;
}

const styles: Record<Status, (text: string) => string> = {
  fail: (text) => ui.fail(text),
  ok: (text) => ui.ok(text),
  skip: (text) => ui.muted(`- ${text}`),
  warn: (text) => ui.warn(`! ${text}`),
};

const DEFAULT_EMAIL_LOOKBACK_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * `doctor`: one line per dependency, with masked or content-free details. It never prints a
 * token, a link, an email subject or body, or the full mailbox address. Exits 1 if any check fails.
 */
export async function runDoctor(
  options: { emailSince: string | undefined },
  context: CliContext,
): Promise<number> {
  const results = [
    ...(await checkGoogle(context, options.emailSince)),
    await checkDrive(context),
    ...(await checkRedis(context)),
  ];

  context.print(ui.heading('Doctor'));

  const width = Math.max(...results.map((result) => result.name.length));

  for (const { detail, name, status } of results) {
    context.print(styles[status](`${name.padEnd(width)}  ${detail}`));
  }

  return results.some((result) => result.status === 'fail') ? 1 : 0;
}

/**
 * The token with its scopes, then the mailbox and the newest export email. The search starts
 * at the start of `emailSince` in the backup time zone, or 30 days ago.
 */
async function checkGoogle(
  context: CliContext,
  emailSince: string | undefined,
): Promise<CheckResult[]> {
  const env = tryLoad(() => loadEnv(googleApiEnvSchema, context.env));

  if (!env.ok) {
    return [
      { detail: env.detail, name: 'google', status: 'fail' },
      { detail: 'needs the Google configuration', name: 'gmail', status: 'skip' },
      { detail: 'needs the Google configuration', name: 'export email', status: 'skip' },
    ];
  }

  const tokens = createTokenProvider(context, env.value);
  const token = await checkToken(tokens);

  if (token.status !== 'ok') {
    return [
      token,
      { detail: 'needs a working Google token', name: 'gmail', status: 'skip' },
      { detail: 'needs a working Google token', name: 'export email', status: 'skip' },
    ];
  }

  const gmail = new GmailApi(createGoogleApi(context, 'gmail', tokens));
  const timeZone = env.value.BACKUP_TIME_ZONE;
  const since =
    emailSince === undefined
      ? new Date(context.clock.now().getTime() - DEFAULT_EMAIL_LOOKBACK_DAYS * DAY_MS)
      : startOfLocalDay(emailSince, timeZone);

  return [
    token,
    await checkMailbox(gmail),
    await checkExportEmail(gmail, context, since, localDateFor(since, timeZone)),
  ];
}

async function checkToken(tokens: OAuthTokenProvider): Promise<CheckResult> {
  try {
    const scopes = await tokens.grantedScopes();

    return {
      detail: `token refreshed, scopes ${scopes.map((scope) => shortScope(scope)).join(', ')}`,
      name: 'google',
      status: 'ok',
    };
  } catch (error) {
    const fix =
      error instanceof IntegrationError && error.code === 'GOOGLE_AUTH_REQUIRED'
        ? '. A Testing token expires after 7 days: run auth:google'
        : '';

    return { detail: `${describe(error)}${fix}`, name: 'google', status: 'fail' };
  }
}

async function checkMailbox(gmail: GmailApi): Promise<CheckResult> {
  try {
    const { emailAddress } = await gmail.getProfile();

    return { detail: `mailbox ${maskEmail(emailAddress)}`, name: 'gmail', status: 'ok' };
  } catch (error) {
    return { detail: describe(error), name: 'gmail', status: 'fail' };
  }
}

async function checkExportEmail(
  gmail: GmailApi,
  context: CliContext,
  since: Date,
  day: string,
): Promise<CheckResult> {
  const finder = new GmailExportEmailFinder({ gmail, logger: context.logger });

  try {
    const result = await finder.findReadyEmail({ excludeIds: [], requestedAfter: since });

    if (result.status === 'found') {
      return {
        detail: `${result.email.messageId}, received ${result.email.receivedAt}; trusted, one allowed link`,
        name: 'export email',
        status: 'ok',
      };
    }

    const rejected = Object.entries(result.rejected)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ');

    // No rejections means the search found nothing at all, which points at the mailbox.
    return {
      detail:
        rejected === ''
          ? `no email from ${EXPORT_EMAIL.sender} in this mailbox since ${day}`
          : `none trusted since ${day} (rejected: ${rejected})`,
      name: 'export email',
      status: 'warn',
    };
  } catch (error) {
    return { detail: describe(error), name: 'export email', status: 'fail' };
  }
}

/** C1 only: read-only. `drive:check` runs the write checks. */
async function checkDrive(context: CliContext): Promise<CheckResult> {
  const env = tryLoad(() => loadEnv(driveEnvSchema, context.env));

  if (!env.ok) {
    return { detail: env.detail, name: 'drive root', status: 'fail' };
  }

  try {
    const api = createGoogleApi(context, 'drive', createTokenProvider(context, env.value));
    const check = await checkDriveRoot(api, env.value.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID);

    return {
      detail: check.outcome === 'pass' ? check.detail : `${check.detail}; run drive:check`,
      name: 'drive root',
      status: check.outcome === 'pass' ? 'ok' : 'fail',
    };
  } catch (error) {
    return { detail: describe(error), name: 'drive root', status: 'fail' };
  }
}

/** Redis, then the Notion session secret of `APP_ENV`. */
async function checkRedis(context: CliContext): Promise<CheckResult[]> {
  const env = tryLoad(() => loadEnv(persistenceEnvSchema, context.env));

  if (!env.ok) {
    return [
      { detail: env.detail, name: 'redis', status: 'fail' },
      { detail: 'needs Redis', name: 'notion session', status: 'skip' },
    ];
  }

  const redis = context.createRedis({
    token: env.value.UPSTASH_REDIS_REST_TOKEN,
    url: env.value.UPSTASH_REDIS_REST_URL,
  });

  try {
    await redis.ping();
  } catch (error) {
    return [
      { detail: describe(error), name: 'redis', status: 'fail' },
      { detail: 'needs Redis', name: 'notion session', status: 'skip' },
    ];
  }

  const redisResult: CheckResult = {
    detail: `reachable, APP_ENV ${env.value.APP_ENV}`,
    name: 'redis',
    status: 'ok',
  };
  const secretEnv = tryLoad(() => loadEnv(secretStoreEnvSchema, context.env));

  if (!secretEnv.ok) {
    return [redisResult, { detail: secretEnv.detail, name: 'notion session', status: 'fail' }];
  }

  const store = new RedisSecretStore({
    appEnv: secretEnv.value.APP_ENV,
    clock: context.clock,
    key: createEnvelopeKey(secretEnv.value.APP_ENCRYPTION_KEY),
    keyPrefix: keyPrefixFor(secretEnv.value.APP_ENV),
    redis,
  });

  try {
    const secret = await store.get('notion-storage-state');

    if (secret === undefined) {
      return [
        redisResult,
        {
          detail: `not stored for APP_ENV ${secretEnv.value.APP_ENV}; run auth:notion`,
          name: 'notion session',
          status: 'warn',
        },
      ];
    }

    const ageDays = Math.floor(
      (context.clock.now().getTime() - new Date(secret.createdAt).getTime()) / DAY_MS,
    );
    // auth:notion records the earliest sign-in cookie expiry in the envelope's meta.
    const expiry =
      typeof secret.meta.authCookieExpiresAt === 'string'
        ? `; sign-in until ${secret.meta.authCookieExpiresAt}`
        : '';

    return [
      redisResult,
      {
        detail: `stored ${secret.createdAt} (${ageDays} days ago), opens with APP_ENCRYPTION_KEY${expiry}`,
        name: 'notion session',
        status: 'ok',
      },
    ];
  } catch (error) {
    return [redisResult, { detail: describe(error), name: 'notion session', status: 'fail' }];
  }
}

type Loaded<T> = { detail: string; ok: false } | { ok: true; value: T };

function tryLoad<T>(load: () => T): Loaded<T> {
  try {
    return { ok: true, value: load() };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { detail: `${error.message} in .env.local`, ok: false };
    }

    throw error;
  }
}

/** A code and a static message: errors from the adapters never carry content. */
function describe(error: unknown): string {
  if (error instanceof IntegrationError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof EnvelopeError) {
    return `${error.code}: ${error.message}`;
  }

  return error instanceof Error ? `${error.name}: unexpected failure` : 'unexpected failure';
}
