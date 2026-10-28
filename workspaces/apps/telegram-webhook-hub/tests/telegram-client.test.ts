import { describe, expect, it, vi } from 'vitest';

import { TelegramApiError, TelegramClient } from '../src/adapters/telegram-client.js';
import { bodyText } from './support.js';
import { botToken } from './support.js';

describe('Telegram Bot API adapter', () => {
  it('maps messages and buttons to HTML without previews and returns the ID', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true, result: { message_id: 7 } }));
    const client = new TelegramClient({ fetch, token: botToken });
    expect(
      await client.sendMessage('1234', {
        buttons: [
          [
            { callbackData: 'nb-prod:s:', text: 'Status' },
            { text: 'Open', url: 'https://example.com' },
          ],
        ],
        html: '<b>Hello</b>',
      }),
    ).toEqual({ messageId: 7 });
    expect(JSON.parse(bodyText(fetch.mock.calls[0]?.[1]))).toEqual({
      chat_id: '1234',
      link_preview_options: { is_disabled: true },
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { callback_data: 'nb-prod:s:', text: 'Status' },
            { text: 'Open', url: 'https://example.com' },
          ],
        ],
      },
      text: '<b>Hello</b>',
    });
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('answers callbacks and removes old keyboards', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true, result: true })));
    const client = new TelegramClient({ fetch, token: botToken });
    await client.answerCallbackQuery('tap', 'Queued');
    await client.removeButtons('1234', 10);
    expect(JSON.parse(bodyText(fetch.mock.calls[0]?.[1]))).toEqual({
      callback_query_id: 'tap',
      text: 'Queued',
    });
    expect(JSON.parse(bodyText(fetch.mock.calls[1]?.[1]))).toEqual({
      chat_id: '1234',
      message_id: 10,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it('never includes Bot API error descriptions or network URLs in its errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ description: `Unauthorized ${botToken}`, error_code: 401, ok: false }),
      )
      .mockRejectedValueOnce(new Error(`https://api.telegram.org/bot${botToken}`));
    const client = new TelegramClient({ fetch, token: botToken });

    for (let i = 0; i < 2; i++) {
      await expect(client.getMe()).rejects.toSatisfy(
        (error: unknown) => error instanceof TelegramApiError && !String(error).includes(botToken),
      );
    }
  });

  it('reports Telegram retry timing and malformed replies', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ error_code: 429, ok: false, parameters: { retry_after: 10 } }),
      )
      .mockResolvedValueOnce(new Response('not JSON', { status: 502 }));
    const client = new TelegramClient({ fetch, token: botToken });
    await expect(client.getMe()).rejects.toMatchObject({ errorCode: 429, retryAfterSec: 10 });
    await expect(client.getMe()).rejects.toMatchObject({ errorCode: 502, failure: 'http' });
  });
});
