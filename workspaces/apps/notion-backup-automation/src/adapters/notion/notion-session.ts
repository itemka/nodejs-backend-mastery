import { z } from 'zod';

import { IntegrationError } from '../../application/integration-error.js';
import type { NotionLoginInfo, SecretStore, StoredSecret } from '../../application/ports.js';
import type { EnvelopeMeta } from '../../shared/envelope-crypto.js';
import { EnvelopeError } from '../../shared/envelope-crypto.js';
import { cookieHeaderFor } from '../transfer/download-cookies.js';
import { NOTION_FILE } from '../transfer/http-downloader.js';

/** The app session (S2): `token_v2` on `.app.notion.com`. Without it, nobody is signed in. */
export const SESSION_COOKIE = 'token_v2';

/** The export file host's credential (S2): the download fails without it. */
export const FILE_HOST_COOKIE = 'file_token';

/** The sign-in cookies: the app session, and the file host's. */
const AUTH_COOKIES = new Set([SESSION_COOKIE, FILE_HOST_COOKIE]);

/** The app (`app.notion.com`), the file host (`file.notion.com`) and anything left on `notion.so`. */
const notionHostPattern = /(?:^|\.)notion\.(?:com|so)$/;

/** Where `dev:download` and the transfer send the cookies; the report checks the same match. */
const FILE_HOST_URL = new URL(`https://${NOTION_FILE.host}${NOTION_FILE.pathPrefix}`);

const SECRET_NAME = 'notion-storage-state';

/** A host or cookie domain (a leading dot is ignored) of Notion's. */
export function isNotionHost(hostOrDomain: string): boolean {
  return notionHostPattern.test(hostOrDomain.toLowerCase().replace(/^\./, ''));
}

const cookieSchema = z.object({
  domain: z.string().min(1),
  /** Seconds since the epoch; -1 for a session cookie. */
  expires: z.number(),
  httpOnly: z.boolean(),
  name: z.string().min(1),
  path: z.string(),
  sameSite: z.enum(['Lax', 'None', 'Strict']),
  secure: z.boolean(),
  value: z.string(),
});

const originSchema = z.object({
  localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
  origin: z.string(),
});

/**
 * Playwright's `storageState()`: cookies and localStorage. It is the secret's value, as JSON, so
 * the transfer reads the same cookies. Other fields (IndexedDB, passkeys) are dropped.
 */
export const storageStateSchema = z.object({
  cookies: z.array(cookieSchema),
  origins: z.array(originSchema),
});

export type NotionStorageState = z.infer<typeof storageStateSchema>;

/** The signed-in browser's identity. Every later context replays it with the session (S2). */
export const browserFingerprintSchema = z.object({
  locale: z.string().min(1).max(64),
  timezoneId: z.string().min(1).max(64),
  userAgent: z.string().min(1).max(512),
  viewport: z.object({
    height: z.number().int().min(200).max(10_000),
    width: z.number().int().min(200).max(10_000),
  }),
});

export type BrowserFingerprint = z.infer<typeof browserFingerprintSchema>;

/**
 * The envelope's `meta`: authenticated, not encrypted, so it holds no cookie or storage value.
 * `authCookieExpiresAt` is absent when every sign-in cookie is a session cookie.
 */
const sessionMetaSchema = z.object({
  authCookieExpiresAt: z.iso.datetime().optional(),
  fileHostCookie: z.boolean(),
  locale: browserFingerprintSchema.shape.locale,
  timezoneId: browserFingerprintSchema.shape.timezoneId,
  userAgent: browserFingerprintSchema.shape.userAgent,
  viewportHeight: browserFingerprintSchema.shape.viewport.shape.height,
  viewportWidth: browserFingerprintSchema.shape.viewport.shape.width,
});

/** A signed-in browser's session, reduced to what Notion needs. */
export interface CapturedSession {
  /** The earliest expiry of the sign-in cookies; undefined when all are session cookies. */
  readonly authCookieExpiresAt: string | undefined;
  /** Whether an unexpired `file_token` reaches `file.notion.com`, as the export download needs. */
  readonly fileHostCookie: boolean;
  readonly fingerprint: BrowserFingerprint;
  readonly storageState: NotionStorageState;
}

export interface NotionSession extends CapturedSession {
  /** When `auth:notion` saved it. */
  readonly createdAt: string;
}

/**
 * Keeps Notion's cookies and the localStorage of Notion's HTTPS origins, and nothing else. A
 * state without an unexpired `token_v2` is `NOTION_SESSION_EXPIRED`: nobody signed in.
 */
export function captureSession(
  storageState: unknown,
  fingerprint: unknown,
  now: Date,
): CapturedSession {
  const state = storageStateSchema.parse(storageState);
  const cookies = state.cookies.filter((cookie) => isNotionHost(cookie.domain));
  const origins = state.origins.filter(({ origin }) => isNotionOrigin(origin));
  const signIn = cookies.filter(
    (cookie) =>
      AUTH_COOKIES.has(cookie.name) &&
      (cookie.expires === -1 || cookie.expires * 1000 > now.getTime()),
  );

  if (!signIn.some((cookie) => cookie.name === SESSION_COOKIE)) {
    throw new IntegrationError(
      'NOTION_SESSION_EXPIRED',
      `The browser holds no unexpired Notion sign-in cookie (${SESSION_COOKIE})`,
    );
  }

  const expiries = signIn.filter((cookie) => cookie.expires !== -1).map((cookie) => cookie.expires);

  return {
    authCookieExpiresAt:
      expiries.length === 0 ? undefined : new Date(Math.min(...expiries) * 1000).toISOString(),
    // Another cookie for the whole domain matches the file host too, but does not let it serve.
    fileHostCookie:
      cookieHeaderFor(
        cookies.filter((cookie) => cookie.name === FILE_HOST_COOKIE),
        FILE_HOST_URL,
        now,
      ) !== undefined,
    fingerprint: browserFingerprintSchema.parse(fingerprint),
    storageState: { cookies, origins },
  };
}

/** The envelope `meta` for a captured session: the fingerprint and the cookie facts, no values. */
export function sessionMeta(session: CapturedSession): EnvelopeMeta {
  const { locale, timezoneId, userAgent, viewport } = session.fingerprint;

  return {
    ...(session.authCookieExpiresAt === undefined
      ? {}
      : { authCookieExpiresAt: session.authCookieExpiresAt }),
    fileHostCookie: session.fileHostCookie,
    locale,
    timezoneId,
    userAgent,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  };
}

/**
 * Whether the browser's cookies differ from the saved ones: a value, an expiry or the set of
 * cookies. A rolling refresh saves the session again only then.
 */
export function sessionCookiesChanged(
  saved: NotionStorageState,
  current: NotionStorageState,
): boolean {
  const fingerprint = (state: NotionStorageState) =>
    state.cookies
      .map(({ domain, expires, name, path, value }) =>
        JSON.stringify([domain, path, name, value, expires]),
      )
      .toSorted()
      .join('\n');

  return fingerprint(saved) !== fingerprint(current);
}

export interface NotionSessionStoreOptions {
  secrets: SecretStore;
}

/**
 * The Notion session in the secret store (`secret:notion-storage-state`), encrypted with
 * `APP_ENCRYPTION_KEY`. The value is the `storageState` JSON; the fingerprint and the cookie
 * facts are the envelope's `meta`.
 */
export class NotionSessionStore implements NotionLoginInfo {
  private readonly secrets: SecretStore;

  constructor({ secrets }: NotionSessionStoreOptions) {
    this.secrets = secrets;
  }

  /** The saved sign-in's recorded expiry; undefined when none is saved or it cannot be read. */
  async authCookieExpiresAt(): Promise<string | undefined> {
    try {
      const session = await this.load();

      return session.authCookieExpiresAt;
    } catch (error) {
      if (error instanceof IntegrationError) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * The saved session. None saved, an envelope that does not open (`KEY_MISMATCH` and the
   * like) or an unreadable one is `NOTION_SESSION_EXPIRED`: `auth:notion` saves a new one.
   */
  async load(): Promise<NotionSession> {
    let stored: StoredSecret | undefined;

    try {
      stored = await this.secrets.get(SECRET_NAME);
    } catch (error) {
      if (error instanceof EnvelopeError) {
        throw new IntegrationError(
          'NOTION_SESSION_EXPIRED',
          `The saved Notion session cannot be opened (${error.code})`,
        );
      }

      throw error;
    }

    if (stored === undefined) {
      throw new IntegrationError('NOTION_SESSION_EXPIRED', 'No Notion session is saved');
    }

    const meta = sessionMetaSchema.safeParse(stored.meta);
    const state = storageStateSchema.safeParse(parseJson(stored.value));

    if (!meta.success || !state.success) {
      throw new IntegrationError(
        'NOTION_SESSION_EXPIRED',
        'The saved Notion session is unreadable',
      );
    }

    const { authCookieExpiresAt, fileHostCookie, viewportHeight, viewportWidth, ...identity } =
      meta.data;

    return {
      authCookieExpiresAt,
      createdAt: stored.createdAt,
      fileHostCookie,
      fingerprint: { ...identity, viewport: { height: viewportHeight, width: viewportWidth } },
      storageState: state.data,
    };
  }

  async save(session: CapturedSession): Promise<void> {
    await this.secrets.put(SECRET_NAME, JSON.stringify(session.storageState), sessionMeta(session));
  }
}

function isNotionOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);

    return url.protocol === 'https:' && isNotionHost(url.hostname);
  } catch {
    return false;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
