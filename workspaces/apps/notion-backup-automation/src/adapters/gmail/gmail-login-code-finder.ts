import { NotionLoginError } from '../../application/notion-login-error.js';
import type { LoginCodeFinder, LoginCodeRequest } from '../../application/ports.js';
import { abortable } from '../../shared/abortable.js';
import type { Logger } from '../../shared/logger.js';
import type { SecretValue } from '../../shared/secret-value.js';
import type { Sleep } from '../../shared/sleep.js';
import { pause, systemSleep } from '../../shared/sleep.js';
import { GoogleApiError } from '../google/google-api-client.js';
import type { GmailApi } from './gmail-api.js';
import type { GmailMessage } from './gmail-schemas.js';
import { checkLoginEmail, extractLoginCode, loginEmailQuery } from './login-email-parser.js';

/** S7: the email arrived 4.9–6.6 s after the request; Gmail is asked every 5 s for 60 s. */
export const LOGIN_EMAIL_POLL_MS = 5000;
export const LOGIN_EMAIL_WAIT_MS = 60_000;

/** Vercel's clock against Gmail's `internalDate`: an email this much "before" the request counts. */
export const LOGIN_EMAIL_SKEW_MS = 30_000;

/** Gmail's `after:` has whole-second precision; the search starts a minute before the bound. */
const SEARCH_MARGIN_MS = 60_000;

const MAX_RESULTS = 10;

export interface GmailLoginCodeFinderOptions {
  readonly gmail: GmailApi;
  /** Logs message IDs and rejection reasons only: never a code, subject or body. */
  readonly logger: Logger;
  readonly pollMs?: number;
  readonly sleep?: Sleep;
  readonly waitMs?: number;
}

/** `LoginCodeFinder` over Gmail REST (`gmail.readonly`). */
export class GmailLoginCodeFinder implements LoginCodeFinder {
  private readonly options: Required<GmailLoginCodeFinderOptions>;

  constructor(options: GmailLoginCodeFinderOptions) {
    this.options = {
      pollMs: LOGIN_EMAIL_POLL_MS,
      sleep: systemSleep,
      waitMs: LOGIN_EMAIL_WAIT_MS,
      ...options,
    };
  }

  /** The Gmail profile's address, lowercased: the only address the login may type. */
  async mailbox(signal?: AbortSignal): Promise<string> {
    const { emailAddress } = await abortable(this.options.gmail.getProfile(signal), signal);

    return emailAddress.trim().toLowerCase();
  }

  /**
   * The code of the one trusted login email received after `requestedAt` (less the skew).
   * Throws `NotionLoginError`: `email_missing` once the wait is over, `email_ambiguous` when
   * several arrived, `code_unrecognized` when it holds no single code. Gmail's own failures throw
   * as they are. The login's `signal` reaches every Gmail request and its retries, and an abort
   * rejects at once with its reason, also after an email was found: no code outlives the budget.
   */
  async waitForCode({ requestedAt, signal }: LoginCodeRequest): Promise<SecretValue<string>> {
    const expectedRecipient = await this.mailbox(signal);
    const notBefore = new Date(requestedAt.getTime() - LOGIN_EMAIL_SKEW_MS);
    const query = loginEmailQuery(new Date(notBefore.getTime() - SEARCH_MARGIN_MS));
    const rejected = new Set<string>();

    for (let poll = 1; ; poll += 1) {
      signal?.throwIfAborted();

      const email = await this.newestTrusted(
        query,
        { expectedRecipient, notBefore },
        rejected,
        signal,
      );

      if (email !== undefined) {
        const result = extractLoginCode(email);

        if (!result.ok) {
          this.options.logger.warn('gmail.login_email.unrecognized', {
            messageId: email.id,
            problem: result.problem,
          });

          throw new NotionLoginError(
            'code_unrecognized',
            `The login email holds no single code (${result.problem})`,
          );
        }

        signal?.throwIfAborted();
        this.options.logger.info('gmail.login_email.found', {
          delayMs: Number(email.internalDate) - requestedAt.getTime(),
          messageId: email.id,
          polls: poll,
        });

        return result.code;
      }

      // Counted, not timed: Gmail's own latency comes on top, within the login's budget.
      if (poll * this.options.pollMs >= this.options.waitMs) {
        this.options.logger.warn('gmail.login_email.missing', { polls: poll });

        throw new NotionLoginError('email_missing', 'No trusted login email arrived in time');
      }

      await pause(this.options.sleep, this.options.pollMs, signal);
    }
  }

  /**
   * The one hit that passes every trust check; a rejected hit is not fetched again. Several
   * trusted hits, or a full page of hits, throw `email_ambiguous`.
   */
  private async newestTrusted(
    query: string,
    check: { readonly expectedRecipient: string; readonly notBefore: Date },
    rejected: Set<string>,
    signal: AbortSignal | undefined,
  ): Promise<GmailMessage | undefined> {
    const { ids, nextPageToken } = await abortable(
      this.options.gmail.listMessageIds(query, MAX_RESULTS, undefined, signal),
      signal,
    );

    // More hits than a page in this short window is not Notion answering one request.
    if (nextPageToken !== undefined) {
      throw ambiguous('More login emails than one search page');
    }

    const trusted: GmailMessage[] = [];

    for (const id of ids.filter((messageId) => !rejected.has(messageId))) {
      let message: GmailMessage;

      try {
        message = await abortable(this.options.gmail.getMessage(id, signal), signal);
      } catch (error) {
        // A listed message can disappear; other failures must still end the search.
        if (error instanceof GoogleApiError && error.status === 404) {
          continue;
        }

        throw error;
      }

      const rejection = checkLoginEmail(message, check);

      if (rejection === undefined) {
        trusted.push(message);
      } else {
        rejected.add(id);
        this.options.logger.info('gmail.login_email.rejected', { messageId: id, rejection });
      }
    }

    // Anyone who knows the address can ask Notion for a code; with two genuine emails in the
    // window, the one this login asked for cannot be told apart, so nothing is typed.
    if (trusted.length > 1) {
      throw ambiguous('Several trusted login emails arrived');
    }

    return trusted[0];
  }
}

function ambiguous(message: string): NotionLoginError {
  return new NotionLoginError('email_ambiguous', message);
}
