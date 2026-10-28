import { telegramMessageSchema } from '@workspaces/telegram-contracts';
import { describe, expect, it, vi } from 'vitest';

import { TelegramApiError } from '../src/adapters/telegram-client.js';
import { serveWebhook } from '../src/config/containers.js';
import { readIntegrations } from '../src/config/env.js';
import { handleWebhookRequest, parseTelegramUpdate } from '../src/http/webhook.js';
import { bodyText } from './support.js';
import { statusOf } from './support.js';
import {
  callback,
  env,
  fakeClient,
  FakeState,
  integration,
  secret,
  update,
  webhookRequest,
} from './support.js';

function harness() {
  const client = fakeClient();
  const state = new FakeState();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}'));
  const deps = {
    chatId: '1234',
    client,
    fetch,
    integrations: [integration],
    legacyIntegrationId: 'nb-prod',
    state,
    webhookSecret: secret,
  };

  return { client, deps, fetch, state };
}

describe('Telegram webhook', () => {
  it('rejects unauthorized traffic before reading runtime configuration', async () => {
    const response = await serveWebhook(webhookRequest(update(), 'wrong'), {
      TELEGRAM_WEBHOOK_SECRET: secret,
    });
    expect(response.status).toBe(401);
  });

  it('refuses incomplete authenticated configuration and wrong methods', async () => {
    expect(
      await statusOf(serveWebhook(webhookRequest(update()), { TELEGRAM_WEBHOOK_SECRET: secret })),
    ).toBe(503);
    const request = new Request('https://hub.example/api/webhook', {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
    });
    expect(await statusOf(serveWebhook(request, env))).toBe(405);
  });

  it('dispatches configured commands as sanitized contract payloads with a separate bearer token', async () => {
    const h = harness();
    expect(
      await statusOf(handleWebhookRequest(webhookRequest(update('/backup_status')), h.deps)),
    ).toBe(200);
    const [url, options] = h.fetch.mock.calls[0]!;
    expect(url).toBe(integration.url);
    expect(options?.headers).toMatchObject({ authorization: `Bearer ${integration.token}` });
    expect(JSON.parse(bodyText(options))).toEqual({
      input: { kind: 'message', text: '/backup_status' },
      updateId: 1,
    });
    expect(options?.redirect).toBe('error');
  });

  it('strips only the matched callback namespace', async () => {
    const h = harness();
    await handleWebhookRequest(webhookRequest(callback('nb-prod:c:nonce')), h.deps);
    expect(JSON.parse(bodyText(h.fetch.mock.calls[0]?.[1]))).toEqual({
      input: { callbackId: 'callback-1', data: 'c:nonce', kind: 'callback', messageId: 42 },
      updateId: 1,
    });
  });

  it('retains legacy buttons but does not route an unknown namespace or environment to the legacy integration', async () => {
    const h = harness();
    await handleWebhookRequest(webhookRequest(callback('s:2026-10')), h.deps);
    await handleWebhookRequest(webhookRequest(callback('nb-dev:s:2026-10', 2)), h.deps);
    await handleWebhookRequest(webhookRequest(callback('other:r:2026-10', 3)), h.deps);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.client.answerCallbackQuery).toHaveBeenCalledTimes(2);
  });

  it('does not forward malformed namespaced callbacks or plain text as commands', async () => {
    const h = harness();
    await handleWebhookRequest(webhookRequest(callback('nb-prod:', 1)), h.deps);
    await handleWebhookRequest(webhookRequest(callback('nb-prodX', 2)), h.deps);
    await handleWebhookRequest(webhookRequest(update('status', 3)), h.deps);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.client.answerCallbackQuery).toHaveBeenCalledTimes(2);
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps routing destinations in configuration rather than update text', async () => {
    const h = harness();
    await handleWebhookRequest(webhookRequest(update('/https://attacker.example')), h.deps);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.client.sendMessage).toHaveBeenCalledWith(
      '1234',
      expect.objectContaining({ html: expect.stringContaining('/backup_status') }),
    );
  });

  it('paginates help for a valid registry and delivers every command within the contract', async () => {
    const h = harness();
    const integrations = readIntegrations({
      HUB_INTEGRATIONS: JSON.stringify(
        Array.from({ length: 2 }, (_, route) => ({
          ...integration,
          commands: Array.from(
            { length: 100 },
            (_, index) => `a${route}${String(index).padStart(3, '0')}${'z'.repeat(27)}`,
          ),
          id: `app-${route}`,
          token: String(route).repeat(40),
        })),
      ),
    });
    h.client.sendMessage.mockImplementation((_chat, message: unknown) => {
      telegramMessageSchema.parse(message);

      return Promise.resolve({ messageId: 88 });
    });

    expect(
      await statusOf(
        handleWebhookRequest(webhookRequest(update('/help')), { ...h.deps, integrations }),
      ),
    ).toBe(200);
    expect(h.client.sendMessage.mock.calls.length).toBeGreaterThan(1);
    const delivered = h.client.sendMessage.mock.calls.flatMap(([, message]) => {
      const { html } = telegramMessageSchema.parse(message);

      return html.slice('Artsem Automation Hub\nCommands: '.length).split(' · ');
    });
    expect(delivered).toEqual(integrations.flatMap((route) => route.commands.map((c) => `/${c}`)));
    expect(h.state.done.has(1)).toBe(true);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('ignores another sender, another chat, group chats, missing senders, and malformed updates', async () => {
    const h = harness();
    const bodies = [
      { ...update(), message: { ...update().message, from: { id: 999 } } },
      { ...update(), message: { ...update().message, chat: { id: 999 } } },
      { ...update(), message: { ...update().message, chat: { id: 1234, type: 'group' } } },
      { message: { chat: { id: 1234 }, text: '/status' }, update_id: 1 },
      { unexpected: true },
    ];
    for (const body of bodies)
      expect(await statusOf(handleWebhookRequest(webhookRequest(body), h.deps))).toBe(200);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.state.done.size).toBe(0);
  });

  it('requires both callback sender and callback message chat to be the owner', () => {
    const bad = callback();
    bad.callback_query.message.chat.id = 999;
    expect(parseTelegramUpdate(bad, '1234')).toBeUndefined();
    expect(
      parseTelegramUpdate(
        { ...callback(), callback_query: { ...callback().callback_query, from: { id: 999 } } },
        '1234',
      ),
    ).toBeUndefined();
  });

  it('does not call the backend again for a completed update', async () => {
    const h = harness();
    await handleWebhookRequest(webhookRequest(update()), h.deps);
    expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(200);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns retryable status while another invocation has the delivery lease', async () => {
    const h = harness();
    h.state.locks.set(1, 'other-worker');
    expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(503);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.state.locks.get(1)).toBe('other-worker');
  });

  it('releases its own lease after backend failures and retries without consuming another quota unit', async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(503);
    expect(h.state.done.has(1)).toBe(false);
    expect(h.state.locks.size).toBe(0);
    h.state.denied = true;
    expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(200);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.state.counted.size).toBe(1);
  });

  it.each([400, 401, 403, 413])(
    'finishes an update the integration refuses for good (HTTP %i), with a notice',
    async (status) => {
      const h = harness();
      h.fetch.mockResolvedValue(new Response('', { status }));

      expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(200);
      expect(
        await statusOf(handleWebhookRequest(webhookRequest(callback('nb-prod:s:', 2)), h.deps)),
      ).toBe(200);
      expect(h.state.done).toEqual(new Set([1, 2]));
      expect(h.client.sendMessage).toHaveBeenCalledWith('1234', {
        html: 'nb-prod could not handle this command; check its deployment.',
      });
      expect(h.client.answerCallbackQuery).toHaveBeenCalledWith(
        'callback-1',
        'nb-prod could not handle this button',
      );

      expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(200);
      expect(h.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each([408, 429, 500])('keeps an update retryable on HTTP %i', async (status) => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(new Response('', { status }));

    expect(await statusOf(handleWebhookRequest(webhookRequest(update()), h.deps))).toBe(503);
    expect(h.state.done.has(1)).toBe(false);
    expect(h.client.sendMessage).not.toHaveBeenCalled();
  });

  it('releases the lease when the forwarding response is lost', async () => {
    const h = harness();
    h.fetch.mockRejectedValueOnce(new Error('response lost'));
    expect(await statusOf(handleWebhookRequest(webhookRequest(callback()), h.deps))).toBe(503);
    expect(await statusOf(handleWebhookRequest(webhookRequest(callback()), h.deps))).toBe(200);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('acknowledges rate-limited callbacks with a notice and never forwards them', async () => {
    const h = harness();
    h.state.denied = true;
    expect(await statusOf(handleWebhookRequest(webhookRequest(callback()), h.deps))).toBe(200);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.client.answerCallbackQuery).toHaveBeenCalledWith(
      'callback-1',
      expect.stringContaining('Too many'),
    );
    expect(h.state.done.has(1)).toBe(true);
  });

  it('bounds an update body before parsing it', async () => {
    const h = harness();
    const request = new Request('https://hub.example', {
      body: 'x'.repeat(70_000),
      headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
      method: 'POST',
    });
    expect(await statusOf(handleWebhookRequest(request, h.deps))).toBe(200);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'finishes rejected callbacks whose query expired (limited=%s)',
    async (limited) => {
      const h = harness();
      h.state.denied = limited;
      h.client.answerCallbackQuery.mockRejectedValueOnce(
        new TelegramApiError('api', 'Query expired', { errorCode: 400 }),
      );

      expect(
        await statusOf(handleWebhookRequest(webhookRequest(callback('unknown:s:1')), h.deps)),
      ).toBe(200);
      expect(h.state.done.has(1)).toBe(true);
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it('keeps a temporary callback acknowledgement outage retryable', async () => {
    const h = harness();
    h.client.answerCallbackQuery.mockRejectedValueOnce(
      new TelegramApiError('network', 'Network unavailable'),
    );

    expect(
      await statusOf(handleWebhookRequest(webhookRequest(callback('unknown:s:1')), h.deps)),
    ).toBe(503);
    expect(h.state.done.has(1)).toBe(false);
    expect(
      await statusOf(handleWebhookRequest(webhookRequest(callback('unknown:s:1')), h.deps)),
    ).toBe(200);
  });
});
