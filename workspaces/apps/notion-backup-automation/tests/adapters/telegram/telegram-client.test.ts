import { describe, expect, it } from 'vitest';

import {
  TelegramApiError,
  TelegramClient,
} from '../../../src/adapters/telegram/telegram-client.js';
import { SecretValue } from '../../../src/shared/secret-value.js';
import {
  FAKE_CHAT_ID,
  fakeBotToken,
  FakeTelegram,
  hangingReply,
  telegramError,
  telegramOk,
} from '../../support/fake-telegram.js';

function clientFor(telegram: FakeTelegram, timeoutMs?: number): TelegramClient {
  return new TelegramClient({
    fetch: telegram.fetch,
    token: new SecretValue(fakeBotToken),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function failureOf(promise: Promise<unknown>): Promise<TelegramApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TelegramApiError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected a TelegramApiError');
}

function expectNoToken(error: TelegramApiError): void {
  const secret = fakeBotToken.split(':')[1] ?? fakeBotToken;

  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(error.message).not.toContain('api.telegram.org');
}

describe('TelegramClient', () => {
  it('sends HTML without link previews, with inline buttons in Telegram’s shape', async () => {
    const telegram = new FakeTelegram();

    const { messageId } = await clientFor(telegram).sendMessage(FAKE_CHAT_ID, {
      buttons: [
        [
          { callbackData: 's:2026-10', text: 'Status' },
          { text: 'Open in Drive', url: 'https://drive.google.com/file/d/abc/view' },
        ],
      ],
      html: '<b>Hello</b>',
    });

    expect(messageId).toBeGreaterThan(0);
    expect(telegram.calls).toEqual([
      {
        body: {
          chat_id: FAKE_CHAT_ID,
          link_preview_options: { is_disabled: true },
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { callback_data: 's:2026-10', text: 'Status' },
                { text: 'Open in Drive', url: 'https://drive.google.com/file/d/abc/view' },
              ],
            ],
          },
          text: '<b>Hello</b>',
        },
        method: 'sendMessage',
        token: fakeBotToken,
      },
    ]);
  });

  it('sends no reply_markup for a message without buttons', async () => {
    const telegram = new FakeTelegram();

    await clientFor(telegram).sendMessage(FAKE_CHAT_ID, { buttons: [], html: 'plain' });

    expect(telegram.sentMessages()[0]).not.toHaveProperty('reply_markup');
  });

  it('turns ok:false into telegram_<error_code>, with the description but never the token', async () => {
    const telegram = new FakeTelegram().on('sendMessage', () =>
      telegramError(400, 'Bad Request: chat not found'),
    );

    const error = await failureOf(clientFor(telegram).sendMessage(FAKE_CHAT_ID, { html: 'x' }));

    expect(error).toMatchObject({ code: 'telegram_400', errorCode: 400, failure: 'api' });
    expect(error.message).toBe('Telegram sendMessage failed: 400 Bad Request: chat not found');
    expectNoToken(error);
  });

  it('carries Telegram’s retry_after on a 429', async () => {
    const telegram = new FakeTelegram().on('sendMessage', () =>
      telegramError(429, 'Too Many Requests: retry after 7', 7),
    );

    const error = await failureOf(clientFor(telegram).sendMessage(FAKE_CHAT_ID, { html: 'x' }));

    expect(error).toMatchObject({ code: 'telegram_429', retryAfterSec: 7 });
  });

  it('reports a non-JSON reply by its HTTP status', async () => {
    const telegram = new FakeTelegram().on(
      'getMe',
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    );

    const error = await failureOf(clientFor(telegram).getMe());

    expect(error).toMatchObject({ code: 'http', errorCode: 502, failure: 'http' });
  });

  it('drops the fetch error, which may name the URL and so the token', async () => {
    const client = new TelegramClient({
      fetch: () =>
        Promise.reject(
          new TypeError(`fetch failed: https://api.telegram.org/bot${fakeBotToken}/getMe`),
        ),
      token: new SecretValue(fakeBotToken),
    });

    const error = await failureOf(client.getMe());

    expect(error).toMatchObject({ code: 'network', failure: 'network' });
    expect(error.cause).toBeUndefined();
    expectNoToken(error);
  });

  it('times out a request that never answers', async () => {
    const telegram = new FakeTelegram().on('sendMessage', hangingReply);

    const error = await failureOf(clientFor(telegram, 20).sendMessage(FAKE_CHAT_ID, { html: 'x' }));

    expect(error).toMatchObject({ code: 'timeout', failure: 'timeout' });
  });

  it('rejects with the caller’s abort reason', async () => {
    const telegram = new FakeTelegram().on('sendMessage', hangingReply);
    const controller = new AbortController();
    const sending = clientFor(telegram).sendMessage(FAKE_CHAT_ID, { html: 'x' }, controller.signal);
    const reason = new Error('tick budget');

    controller.abort(reason);

    await expect(sending).rejects.toBe(reason);
  });

  it('reads private chats from pending messages without confirming them', async () => {
    const telegram = new FakeTelegram().on('getUpdates', () =>
      telegramOk([
        {
          message: {
            chat: { first_name: 'Artsem', id: 424_242, type: 'private', username: 'artsem' },
            date: 0,
            message_id: 1,
            text: '/start',
          },
          update_id: 10,
        },
        { callback_query: { id: 'x' }, update_id: 11 },
      ]),
    );

    await expect(clientFor(telegram).getUpdates()).resolves.toEqual([
      {
        chat: { firstName: 'Artsem', id: 424_242, type: 'private', username: 'artsem' },
        updateId: 10,
      },
      { updateId: 11 },
    ]);
    expect(telegram.calls[0]?.body).not.toHaveProperty('offset');
  });

  it('reads the webhook info, with the last error redacted', async () => {
    const telegram = new FakeTelegram().on('getWebhookInfo', () =>
      telegramOk({
        last_error_date: 1_790_000_000,
        last_error_message: 'Wrong response: https://other.example.com/hook?key=abc',
        pending_update_count: 3,
        url: 'https://other.example.com/hook',
      }),
    );

    await expect(clientFor(telegram).getWebhookInfo()).resolves.toEqual({
      lastErrorAt: new Date(1_790_000_000_000),
      lastErrorMessage: 'Wrong response: https://other.example.com/hook[redacted]',
      pendingUpdateCount: 3,
      url: 'https://other.example.com/hook',
    });
  });

  it('fails on a reply that does not match the method’s result', async () => {
    const telegram = new FakeTelegram().on('sendMessage', () => telegramOk({ unexpected: true }));

    const error = await failureOf(clientFor(telegram).sendMessage(FAKE_CHAT_ID, { html: 'x' }));

    expect(error.code).toBe('http');
  });
});
