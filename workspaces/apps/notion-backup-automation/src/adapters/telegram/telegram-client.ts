import type { HubOperation, TelegramMessage } from '@workspaces/telegram-contracts';
import { hubOperationSchema, isPermanentRefusal } from '@workspaces/telegram-contracts';
import { z } from 'zod';

import type { SecretValue } from '../../shared/secret-value.js';

export type { TelegramButton, TelegramMessage } from '@workspaces/telegram-contracts';
export { MAX_CALLBACK_DATA_BYTES, MAX_MESSAGE_LENGTH } from '@workspaces/telegram-contracts';

const DEFAULT_TIMEOUT_MS = 10_000;
const MESSAGES_PATH = '/api/messages';
export type TelegramFailure = 'api' | 'http' | 'network' | 'timeout';

/** A content-free hub failure; neither remote errors nor credentials escape. */
export class TelegramApiError extends Error {
  readonly code: string;
  readonly errorCode: number | undefined;
  readonly failure: TelegramFailure;
  readonly retryAfterSec: number | undefined;

  constructor(
    failure: TelegramFailure,
    message: string,
    details: { errorCode?: number; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = 'TelegramApiError';
    this.failure = failure;
    this.errorCode = details.errorCode;
    this.retryAfterSec = details.retryAfterSec;
    this.code = details.errorCode === undefined ? failure : `hub_${details.errorCode}`;
  }
}

/**
 * Whether the hub refused a request for good: any 4xx except 408 and 429, such as an operation
 * it does not accept or Telegram's own refusal (`422 TELEGRAM_REJECTED`). A resend gets the same.
 */
export function isPermanentHubRefusal(error: unknown): error is TelegramApiError {
  return (
    error instanceof TelegramApiError &&
    error.failure === 'api' &&
    isPermanentRefusal(error.errorCode ?? 0)
  );
}

export interface TelegramClientOptions {
  readonly fetch?: typeof fetch;
  readonly hubUrl: string;
  /** This deployment's callback namespace at the hub, from `telegramIntegrationId`. */
  readonly integrationId: string;
  readonly timeoutMs?: number;
  readonly token: SecretValue<string>;
}

/** An integration-scoped HTTP client. Only the hub calls Telegram itself. */
export class TelegramClient {
  private readonly fetchImpl: typeof fetch;
  private readonly hubUrl: string;
  private readonly integrationId: string;
  private readonly timeoutMs: number;
  private readonly token: SecretValue<string>;

  constructor({
    fetch: fetchImpl = globalThis.fetch,
    hubUrl,
    integrationId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    token,
  }: TelegramClientOptions) {
    this.fetchImpl = fetchImpl;
    this.hubUrl = hubUrl;
    this.integrationId = integrationId;
    this.timeoutMs = timeoutMs;
    this.token = token;
  }

  async answerCallbackQuery(
    callbackId: string,
    text?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.send(
      {
        action: 'answerCallbackQuery',
        callbackId,
        ...(text === undefined ? {} : { text: text.slice(0, 200) }),
      },
      z.object({ ok: z.literal(true) }),
      signal,
    );
  }

  async removeButtons(messageId: number, signal?: AbortSignal): Promise<void> {
    await this.send(
      { action: 'removeButtons', messageId },
      z.object({ ok: z.literal(true) }),
      signal,
    );
  }

  async sendMessage(
    message: TelegramMessage,
    signal?: AbortSignal,
  ): Promise<{ messageId: number }> {
    const namespaced = {
      ...message,
      ...(message.buttons === undefined
        ? {}
        : {
            buttons: message.buttons.map((row) =>
              row.map((button) =>
                'callbackData' in button
                  ? { ...button, callbackData: `${this.integrationId}:${button.callbackData}` }
                  : button,
              ),
            ),
          }),
    };
    const operation = hubOperationSchema.parse({ action: 'sendMessage', message: namespaced });

    return this.send(operation, z.object({ messageId: z.number().int().positive() }), signal);
  }

  /**
   * Whether the hub accepts this integration's token, without sending anything: the hub answers
   * an authenticated `GET /api/messages` with 405 and a wrong token with 401.
   */
  async checkAccess(signal?: AbortSignal): Promise<void> {
    const { response } = await this.fetchHub({ method: 'GET' }, signal);

    if (response.status !== 405) {
      throw new TelegramApiError(
        'api',
        `Telegram hub token check failed (HTTP ${response.status})`,
        {
          errorCode: response.status,
        },
      );
    }
  }

  private async send<T>(
    operation: HubOperation,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { body, response } = await this.fetchHub(
      {
        body: JSON.stringify(hubOperationSchema.parse(operation)),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
      signal,
    );

    if (!response.ok) {
      const after = Number(response.headers.get('retry-after'));

      throw new TelegramApiError('api', `Telegram hub request failed (HTTP ${response.status})`, {
        errorCode: response.status,
        ...(Number.isFinite(after) && after > 0 ? { retryAfterSec: after } : {}),
      });
    }

    let raw: unknown;

    try {
      raw = JSON.parse(body) as unknown;
    } catch {
      throw new TelegramApiError('http', 'Telegram hub returned an invalid response');
    }

    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      throw new TelegramApiError('http', 'Telegram hub returned an invalid response');
    }

    return parsed.data;
  }

  /** One call to `/api/messages`, body read within the timeout; a fetch error is never passed on. */
  private async fetchHub(
    init: Pick<RequestInit, 'body' | 'headers' | 'method'>,
    signal: AbortSignal | undefined,
  ): Promise<{ body: string; response: Response }> {
    const timeout = AbortSignal.timeout(this.timeoutMs);

    try {
      const response = await this.fetchImpl(new URL(MESSAGES_PATH, this.hubUrl), {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${this.token.reveal()}` },
        redirect: 'error',
        signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
      });

      return { body: await response.text(), response };
    } catch {
      signal?.throwIfAborted();

      throw new TelegramApiError(
        timeout.aborted ? 'timeout' : 'network',
        timeout.aborted
          ? 'Telegram hub request timed out'
          : 'Telegram hub request failed: network error',
      );
    }
  }
}
