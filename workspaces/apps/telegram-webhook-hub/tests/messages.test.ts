import { describe, expect, it } from 'vitest';

import { TelegramApiError } from '../src/adapters/telegram-client.js';
import { serveMessages } from '../src/config/containers.js';
import { handleMessagesRequest } from '../src/http/messages.js';
import { statusOf } from './support.js';
import { env, fakeClient, integration, messageRequest } from './support.js';

function get(token: string): Request {
  return new Request('https://hub.example/api/messages', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('authenticated outbound operations', () => {
  it('authenticates before bot construction and body parsing', async () => {
    expect(await statusOf(serveMessages(new Request('https://hub.example/api/messages'), {}))).toBe(
      401,
    );
    expect(
      await statusOf(
        serveMessages(messageRequest({}, 'wrong'), { HUB_INTEGRATIONS: env.HUB_INTEGRATIONS }),
      ),
    ).toBe(401);
  });

  it('sends only to the configured owner chat and returns the message ID', async () => {
    const client = fakeClient();
    const response = await handleMessagesRequest(
      messageRequest({
        action: 'sendMessage',
        message: { buttons: [[{ callbackData: 'nb-prod:s:', text: 'Status' }]], html: 'hello' },
      }),
      { chatId: '1234', client, integration },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messageId: 88 });
    expect(client.sendMessage).toHaveBeenCalledWith(
      '1234',
      expect.objectContaining({ html: 'hello' }),
    );
  });

  it.each([
    { action: 'sendMessage', chatId: '999', message: { html: 'hello' } },
    { action: 'setWebhook', url: 'https://attacker.example' },
    {
      action: 'sendMessage',
      message: { buttons: [[{ text: 'Unsafe', url: 'http://unsafe.example' }]], html: 'hello' },
    },
    {
      action: 'sendMessage',
      message: { buttons: [[{ callbackData: 'x'.repeat(65), text: 'Too long' }]], html: 'hello' },
    },
  ])('rejects unsupported destinations, methods and payloads', async (body) => {
    const client = fakeClient();
    expect(
      await statusOf(
        handleMessagesRequest(messageRequest(body), {
          chatId: '1234',
          client,
          integration,
        }),
      ),
    ).toBe(400);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an integration sending callbacks for another integration or legacy callbacks', async () => {
    const client = fakeClient();

    for (const callbackData of ['other:s:', 'nb-dev:s:', 's:']) {
      expect(
        await statusOf(
          handleMessagesRequest(
            messageRequest({
              action: 'sendMessage',
              message: { buttons: [[{ callbackData, text: 'Status' }]], html: 'hello' },
            }),
            { chatId: '1234', client, integration },
          ),
        ),
      ).toBe(403);
    }

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('supports callback answers and button edits', async () => {
    const client = fakeClient();
    const deps = { chatId: '1234', client, integration };
    expect(
      await statusOf(
        handleMessagesRequest(
          messageRequest({ action: 'answerCallbackQuery', callbackId: 'tap', text: 'Queued' }),
          deps,
        ),
      ),
    ).toBe(200);
    expect(
      await statusOf(
        handleMessagesRequest(messageRequest({ action: 'removeButtons', messageId: 12 }), deps),
      ),
    ).toBe(200);
    expect(client.answerCallbackQuery).toHaveBeenCalledWith('tap', 'Queued');
    expect(client.removeButtons).toHaveBeenCalledWith('1234', 12);
  });

  it('answers an authenticated GET with 405, so an integration can check its token', async () => {
    const accepted = await serveMessages(get(integration.token), env);
    expect(accepted.status).toBe(405);
    expect(accepted.headers.get('allow')).toBe('POST');
    expect(await statusOf(serveMessages(get('wrong'), env))).toBe(401);
  });

  it.each([
    { code: 'TELEGRAM_REJECTED', errorCode: 400, status: 422 },
    { code: 'TELEGRAM_REJECTED', errorCode: 403, status: 422 },
    { code: 'TELEGRAM_UNAVAILABLE', errorCode: 429, status: 503 },
  ])(
    'tells a final Telegram refusal from a retryable one (Telegram $errorCode)',
    async ({ code, errorCode, status }) => {
      const client = fakeClient();
      client.sendMessage.mockRejectedValueOnce(
        new TelegramApiError('api', `Telegram sendMessage failed: ${errorCode}`, { errorCode }),
      );
      const response = await handleMessagesRequest(
        messageRequest({ action: 'sendMessage', message: { html: 'hello' } }),
        { chatId: '1234', client, integration },
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
    },
  );

  it('keeps a non-JSON Telegram reply retryable', async () => {
    const client = fakeClient();
    client.removeButtons.mockRejectedValueOnce(
      new TelegramApiError('http', 'unexpected reply', { errorCode: 404 }),
    );

    expect(
      await statusOf(
        handleMessagesRequest(messageRequest({ action: 'removeButtons', messageId: 12 }), {
          chatId: '1234',
          client,
          integration,
        }),
      ),
    ).toBe(503);
  });

  it('reports a transient Telegram failure without leaking the internal error', async () => {
    const client = fakeClient();
    client.sendMessage.mockRejectedValueOnce(new Error('sensitive content'));
    const response = await handleMessagesRequest(
      messageRequest({ action: 'sendMessage', message: { html: 'hello' } }),
      { chatId: '1234', client, integration },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sensitive content');
  });
});
