/** A bot token built at run time, so no token-shaped literal is committed. */
export const fakeBotToken = ['8123456789', `AAH${'f'.repeat(32)}`].join(':');

export const FAKE_CHAT_ID = '424242';

export interface TelegramCall {
  readonly body: Record<string, unknown>;
  readonly method: string;
  readonly token: string;
}

type Reply = (call: TelegramCall, signal: AbortSignal | undefined) => Promise<Response> | Response;

export function telegramOk(result: unknown): Response {
  return Response.json({ ok: true, result });
}

export function telegramError(
  errorCode: number,
  description: string,
  retryAfterSec?: number,
): Response {
  return Response.json(
    {
      description,
      error_code: errorCode,
      ok: false,
      ...(retryAfterSec === undefined ? {} : { parameters: { retry_after: retryAfterSec } }),
    },
    { status: errorCode },
  );
}

/** A reply that never comes; it ends only with the request's abort. */
export const hangingReply: Reply = (_call, signal) =>
  new Promise<Response>((_resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error);

      return;
    }

    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });

/**
 * An in-process stand-in for the Telegram Bot API, passed as `fetch`. It answers `getMe`,
 * `getUpdates`, `getWebhookInfo` and `sendMessage` like Telegram does, records every call, and
 * refuses another token with 401. Unknown hosts and paths get a 599 so they are easy to spot.
 */
export class FakeTelegram {
  readonly calls: TelegramCall[] = [];
  private readonly replies = new Map<string, Reply>();
  private readonly token: string;

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);

    if (url.host !== 'api.telegram.org' || match?.[1] === undefined || match[2] === undefined) {
      return Response.json({ error: `no fake route for ${url.host}` }, { status: 599 });
    }

    const call: TelegramCall = {
      body: JSON.parse(await request.text()) as Record<string, unknown>,
      method: match[2],
      token: match[1],
    };

    this.calls.push(call);

    if (call.token !== this.token) {
      return telegramError(401, 'Unauthorized');
    }

    const reply = this.replies.get(call.method);

    return reply === undefined ? this.defaultReply(call) : reply(call, init?.signal ?? undefined);
  };

  constructor(token = fakeBotToken) {
    this.token = token;
  }

  /** Replaces the reply of `method`. */
  on(method: string, reply: Reply): this {
    this.replies.set(method, reply);

    return this;
  }

  /** The `sendMessage` bodies, in order. */
  sentMessages(): Record<string, unknown>[] {
    return this.calls.filter((call) => call.method === 'sendMessage').map((call) => call.body);
  }

  private defaultReply(call: TelegramCall): Response {
    switch (call.method) {
      case 'getMe': {
        return telegramOk({
          first_name: 'Backup',
          id: 8_123_456_789,
          is_bot: true,
          username: 'test_backup_bot',
        });
      }

      case 'getUpdates': {
        return telegramOk([]);
      }

      case 'getWebhookInfo': {
        return telegramOk({ has_custom_certificate: false, pending_update_count: 0, url: '' });
      }

      case 'sendMessage': {
        return telegramOk({
          chat: { id: Number(call.body.chat_id), type: 'private' },
          date: 0,
          message_id: this.calls.length,
        });
      }

      default: {
        return telegramError(404, 'Not Found');
      }
    }
  }
}
