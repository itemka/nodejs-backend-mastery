import type { TelegramMessage } from '@workspaces/telegram-contracts';
import { z } from 'zod';
export type { TelegramButton, TelegramMessage } from '@workspaces/telegram-contracts';

export const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DESCRIPTION_LENGTH = 200;

export interface TelegramBot {
  readonly id: number;
  readonly username?: string;
}

export interface TelegramChat {
  readonly firstName?: string;
  readonly id: number;
  readonly type: string;
  readonly username?: string;
}

/** A `getUpdates` entry; only messages are read, for `telegram:setup --find-chat`. */
export interface TelegramUpdate {
  readonly chat?: TelegramChat;
  readonly updateId: number;
}

export interface WebhookInfo {
  readonly lastErrorAt?: Date;
  /** Telegram's text, redacted. */
  readonly lastErrorMessage?: string;
  readonly pendingUpdateCount: number;
  /** Empty when no webhook is set. */
  readonly url: string;
}

/**
 * - `api`: Telegram answered `ok: false`;
 * - `http`: a non-JSON reply;
 * - `network`, `timeout`: no reply.
 */
export type TelegramFailure = 'api' | 'http' | 'network' | 'timeout';

/** A failed Bot API call. Its message never holds the token or the request URL. */
export class TelegramApiError extends Error {
  /** `telegram_<error_code>` for an API error, else the failure kind; what `notify.failed` logs. */
  readonly code: string;
  /** Telegram's `error_code`, or the HTTP status of a non-JSON reply. */
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
    this.code =
      failure === 'api' && details.errorCode !== undefined
        ? `telegram_${details.errorCode}`
        : failure;
  }
}

export interface TelegramClientOptions {
  /** Replaced by tests; `https://api.telegram.org` by default. */
  readonly apiOrigin?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly token: string;
}

const userSchema = z.object({ id: z.number().int(), username: z.string().optional() });

const updateSchema = z.object({
  message: z
    .object({
      chat: z.object({
        first_name: z.string().optional(),
        id: z.number().int(),
        type: z.string(),
        username: z.string().optional(),
      }),
    })
    .optional(),
  update_id: z.number().int(),
});

const webhookInfoSchema = z.object({
  last_error_date: z.number().int().optional(),
  last_error_message: z.string().optional(),
  pending_update_count: z.number().int(),
  url: z.string(),
});

const sentMessageSchema = z.object({ message_id: z.number().int() });

const failureSchema = z.object({
  description: z.string().optional(),
  error_code: z.number().int(),
  ok: z.literal(false),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

/**
 * The few Bot API methods the app uses, as JSON `POST`s over `fetch`, with no SDK. The token is
 * part of every request path, so neither a URL nor a `fetch` error is ever passed on.
 */
export class TelegramClient {
  private readonly apiOrigin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly token: string;

  constructor({
    apiOrigin = TELEGRAM_API_ORIGIN,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    token,
  }: TelegramClientOptions) {
    this.apiOrigin = apiOrigin;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.token = token;
  }

  /** Ends the spinner on a tapped button, with an optional short notice (≤ 200 characters). */
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call(
      'answerCallbackQuery',
      {
        callback_query_id: callbackQueryId,
        ...(text === undefined ? {} : { text: clip(text) }),
      },
      z.literal(true),
      signal,
    );
  }

  /** Removes a message's buttons, so an action cannot be tapped twice. */
  async removeButtons(chatId: string, messageId: number, signal?: AbortSignal): Promise<void> {
    await this.call(
      'editMessageReplyMarkup',
      { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } },
      z.union([z.literal(true), sentMessageSchema]),
      signal,
    );
  }

  /**
   * Points the bot's updates at `url`: only messages and button taps, each carrying
   * `secretToken` in `X-Telegram-Bot-Api-Secret-Token`. Configuring or replacing the webhook
   * preserves pending updates.
   */
  async setWebhook(
    { secretToken, url }: { secretToken: string; url: string },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call(
      'setWebhook',
      {
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
        secret_token: secretToken,
        url,
      },
      z.literal(true),
      signal,
    );
  }

  async getMe(signal?: AbortSignal): Promise<TelegramBot> {
    const bot = await this.call('getMe', {}, userSchema, signal);

    return { id: bot.id, ...(bot.username === undefined ? {} : { username: bot.username }) };
  }

  /**
   * Pending messages, without confirming them: no `offset` is sent, so Telegram keeps them.
   * Fails with `telegram_409` while a webhook is set.
   */
  async getUpdates(signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const updates = await this.call(
      'getUpdates',
      { allowed_updates: ['message'], limit: 100, timeout: 0 },
      z.array(updateSchema),
      signal,
    );

    return updates.map(({ message, update_id: updateId }) => {
      if (message === undefined) {
        return { updateId };
      }

      const { first_name: firstName, id, type, username } = message.chat;

      return {
        chat: {
          id,
          type,
          ...(firstName === undefined ? {} : { firstName }),
          ...(username === undefined ? {} : { username }),
        },
        updateId,
      };
    });
  }

  async getWebhookInfo(signal?: AbortSignal): Promise<WebhookInfo> {
    const info = await this.call('getWebhookInfo', {}, webhookInfoSchema, signal);

    return {
      pendingUpdateCount: info.pending_update_count,
      url: info.url,
      ...(info.last_error_date === undefined
        ? {}
        : { lastErrorAt: new Date(info.last_error_date * 1000) }),
      ...(info.last_error_message === undefined
        ? {}
        : { lastErrorMessage: 'Telegram reported a webhook delivery error' }),
    };
  }

  /** Sends `message` in HTML parse mode, without link previews. */
  async sendMessage(
    chatId: string,
    message: TelegramMessage,
    signal?: AbortSignal,
  ): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      link_preview_options: { is_disabled: true },
      parse_mode: 'HTML',
      text: message.html,
    };

    if (message.buttons !== undefined && message.buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: message.buttons.map((row) =>
          row.map((button) =>
            'url' in button
              ? { text: button.text, url: button.url }
              : { callback_data: button.callbackData, text: button.text },
          ),
        ),
      };
    }

    const sent = await this.call('sendMessage', body, sentMessageSchema, signal);

    return { messageId: sent.message_id };
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    resultSchema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    let text: string;

    try {
      response = await this.fetchImpl(`${this.apiOrigin}/bot${this.token}/${method}`, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        redirect: 'error',
        signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
      });
      // Read inside the try: a stalled body ends with the timeout, like a stalled request.
      text = await response.text();
    } catch {
      // The caller's abort wins; the error itself is dropped, since it may name the URL.
      signal?.throwIfAborted();

      throw timeout.aborted
        ? new TelegramApiError('timeout', `Telegram ${method} timed out`)
        : new TelegramApiError('network', `Telegram ${method} failed: network error`);
    }

    const result = z
      .object({ ok: z.literal(true), result: resultSchema })
      .or(failureSchema)
      .safeParse(parseJson(text));

    if (!result.success) {
      throw new TelegramApiError(
        'http',
        `Telegram ${method} returned an unexpected reply (HTTP ${response.status})`,
        { errorCode: response.status },
      );
    }

    if (!result.data.ok) {
      const { error_code: errorCode, parameters } = result.data;
      const retryAfterSec = parameters?.retry_after;

      throw new TelegramApiError('api', `Telegram ${method} failed: ${errorCode}`, {
        errorCode,
        ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
      });
    }

    return result.data.result;
  }
}

/** Unparseable text is not JSON at all; the schema check then reports the reply. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function clip(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH
    ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
    : text;
}
