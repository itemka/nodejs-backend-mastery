import { hubOperationSchema } from '@workspaces/telegram-contracts';

/** A bot-shaped value remains solely as a redaction fixture for message formatting. */
export const fakeBotToken = ['8123456789', `AAH${'f'.repeat(32)}`].join(':');
export const fakeHubToken = ['integration', 'f'.repeat(40)].join('-');
export const FAKE_HUB_URL = 'https://hub.example';

export interface TelegramCall {
  readonly body: Record<string, unknown>;
  readonly method: string;
  readonly token: string;
}

type Reply = (call: TelegramCall, signal: AbortSignal | undefined) => Promise<Response> | Response;

export function telegramOk(result: unknown): Response {
  return Response.json(result === true ? { ok: true } : result);
}

export function telegramError(
  errorCode: number,
  description: string,
  retryAfterSec?: number,
): Response {
  return Response.json(
    { error: { code: 'HUB_ERROR', message: description } },
    {
      status: errorCode,
      ...(retryAfterSec === undefined ? {} : { headers: { 'retry-after': String(retryAfterSec) } }),
    },
  );
}

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

/** Fake authenticated hub transport, with no Telegram Bot API implementation. */
export class FakeTelegram {
  readonly calls: TelegramCall[] = [];
  private readonly replies = new Map<string, Reply>();
  private readonly token: string;

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.origin !== FAKE_HUB_URL || url.pathname !== '/api/messages') {
      return Response.json({ error: 'No fake hub route' }, { status: 599 });
    }

    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';

    if (token !== this.token) {
      return telegramError(401, 'Unauthorized');
    }

    // Like the hub: an authenticated GET is the integration's token check.
    if (request.method !== 'POST') {
      return new Response(undefined, { headers: { allow: 'POST' }, status: 405 });
    }

    const operation = hubOperationSchema.safeParse(await request.json());

    if (!operation.success) {
      return telegramError(400, 'Invalid operation');
    }

    const { action, ...payload } = operation.data;
    const call: TelegramCall = {
      body: action === 'sendMessage' && 'message' in payload ? payload.message : payload,
      method: action,
      token,
    };

    this.calls.push(call);
    const reply = this.replies.get(action);

    if (reply !== undefined) {
      return reply(call, request.signal);
    }

    return action === 'sendMessage'
      ? Response.json({ messageId: this.calls.length })
      : Response.json({ ok: true });
  };

  constructor(token = fakeHubToken) {
    this.token = token;
  }
  on(method: string, reply: Reply): this {
    this.replies.set(method, reply);

    return this;
  }
  sentMessages(): Record<string, unknown>[] {
    return this.bodiesOf('sendMessage');
  }
  bodiesOf(method: string): Record<string, unknown>[] {
    return this.calls.filter((call) => call.method === method).map((call) => call.body);
  }
}
