import { describe, expect, it } from 'vitest';

import {
  isPermanentHubRefusal,
  TelegramApiError,
  TelegramClient,
} from '../../../src/adapters/telegram/telegram-client.js';
import { SecretValue } from '../../../src/shared/secret-value.js';
import {
  FAKE_HUB_URL,
  fakeHubToken,
  FakeTelegram,
  hangingReply,
  telegramError,
} from '../../support/fake-telegram.js';

function clientFor(hub: FakeTelegram, timeoutMs = 10_000, integrationId = 'nb-prod') {
  return new TelegramClient({
    fetch: hub.fetch,
    hubUrl: FAKE_HUB_URL,
    integrationId,
    timeoutMs,
    token: new SecretValue(fakeHubToken),
  });
}

describe('the Telegram hub client', () => {
  it('sends only an authenticated allowlisted operation, namespacing every callback', async () => {
    const hub = new FakeTelegram();
    await expect(
      clientFor(hub).sendMessage({
        buttons: [
          [
            { callbackData: 's:2026-10', text: 'Status' },
            { text: 'Drive', url: 'https://drive.google.com/file/d/f/view' },
          ],
        ],
        html: '<b>Ready</b>',
      }),
    ).resolves.toEqual({ messageId: 1 });
    expect(hub.calls).toEqual([
      {
        body: {
          buttons: [
            [
              { callbackData: 'nb-prod:s:2026-10', text: 'Status' },
              { text: 'Drive', url: 'https://drive.google.com/file/d/f/view' },
            ],
          ],
          html: '<b>Ready</b>',
        },
        method: 'sendMessage',
        token: fakeHubToken,
      },
    ]);
  });

  it('isolates development callbacks from production and checks the full byte limit before sending', async () => {
    const hub = new FakeTelegram();
    await clientFor(hub, 10_000, 'nb-dev').sendMessage({
      buttons: [[{ callbackData: 'x:2026-10', text: 'Cancel' }]],
      html: 'x',
    });
    expect(JSON.stringify(hub.sentMessages())).toContain('nb-dev:x:2026-10');
    await expect(
      clientFor(hub).sendMessage({
        buttons: [[{ callbackData: 's:' + 'a'.repeat(58), text: 'x' }]],
        html: 'x',
      }),
    ).rejects.toThrow('64 bytes');
    expect(hub.calls).toHaveLength(1);
  });

  it('can answer callbacks and remove buttons without selecting any chat', async () => {
    const hub = new FakeTelegram();
    await clientFor(hub).answerCallbackQuery('cb-1', 'done');
    await clientFor(hub).removeButtons(10);
    expect(hub.bodiesOf('answerCallbackQuery')).toEqual([{ callbackId: 'cb-1', text: 'done' }]);
    expect(hub.bodiesOf('removeButtons')).toEqual([{ messageId: 10 }]);
  });

  it('reports status and retry timing but never remote response details', async () => {
    const hub = new FakeTelegram().on('sendMessage', () =>
      telegramError(429, `private ${fakeHubToken}`, 7),
    );
    const error = await clientFor(hub)
      .sendMessage({ html: 'x' })
      .catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error).toMatchObject({ code: 'hub_429', failure: 'api', retryAfterSec: 7 });
    expect(JSON.stringify(error)).not.toContain(fakeHubToken);
  });

  it('refuses a malformed success reply', async () => {
    const hub = new FakeTelegram().on('sendMessage', () => Response.json({ ok: true }));
    await expect(clientFor(hub).sendMessage({ html: 'x' })).rejects.toMatchObject({
      failure: 'http',
    });
  });

  it('hides URLs and credentials from network errors', async () => {
    const client = new TelegramClient({
      fetch: () => Promise.reject(new Error(`private ${fakeHubToken}`)),
      hubUrl: FAKE_HUB_URL,
      integrationId: 'nb-prod',
      token: new SecretValue(fakeHubToken),
    });
    await expect(client.sendMessage({ html: 'x' })).rejects.toMatchObject({
      failure: 'network',
      message: 'Telegram hub request failed: network error',
    });
  });

  it('checks the token with an authenticated GET that sends nothing', async () => {
    const requests: Request[] = [];
    const hub = new FakeTelegram();

    const recording: typeof fetch = (input, init) => {
      requests.push(new Request(input, init));

      return hub.fetch(input, init);
    };

    const client = new TelegramClient({
      fetch: recording,
      hubUrl: FAKE_HUB_URL,
      integrationId: 'nb-prod',
      token: new SecretValue(fakeHubToken),
    });

    await expect(client.checkAccess()).resolves.toBeUndefined();
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${FAKE_HUB_URL}/api/messages`,
    ]);
    expect(hub.calls).toEqual([]);

    await expect(
      clientFor(new FakeTelegram('another-token-'.padEnd(40, 'x'))).checkAccess(),
    ).rejects.toMatchObject({ code: 'hub_401', failure: 'api' });
  });

  it.each([
    { error: new TelegramApiError('api', 'refused', { errorCode: 400 }), permanent: true },
    { error: new TelegramApiError('api', 'refused', { errorCode: 403 }), permanent: true },
    { error: new TelegramApiError('api', 'refused', { errorCode: 422 }), permanent: true },
    { error: new TelegramApiError('api', 'timeout', { errorCode: 408 }), permanent: false },
    { error: new TelegramApiError('api', 'limited', { errorCode: 429 }), permanent: false },
    { error: new TelegramApiError('api', 'down', { errorCode: 503 }), permanent: false },
    { error: new TelegramApiError('http', 'odd reply', { errorCode: 404 }), permanent: false },
    { error: new TelegramApiError('network', 'offline'), permanent: false },
    { error: new Error('not a hub error'), permanent: false },
  ])(
    'tells a final hub refusal from a retryable failure: $error.message',
    ({ error, permanent }) => {
      expect(isPermanentHubRefusal(error)).toBe(permanent);
    },
  );

  it('times out a stalled response and respects the caller abort', async () => {
    const hub = new FakeTelegram().on('sendMessage', hangingReply);
    await expect(clientFor(hub, 20).sendMessage({ html: 'x' })).rejects.toMatchObject({
      failure: 'timeout',
    });
    const controller = new AbortController();
    const pending = clientFor(hub).sendMessage({ html: 'x' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
