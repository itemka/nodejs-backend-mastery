import { describe, expect, it, vi } from 'vitest';

import { TelegramClient } from '../src/adapters/telegram-client.js';
import { runTelegramSetup } from '../src/cli/setup.js';
import { bodyText } from './support.js';
import { botToken, env } from './support.js';

function harness(initialUrl = '') {
  let webhookUrl = initialUrl;
  const calls: { body: Record<string, unknown>; method: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>((input, options) => {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    const method = requestUrl.split('/').at(-1) ?? '';
    const body = JSON.parse(bodyText(options)) as Record<string, unknown>;
    calls.push({ body, method });
    let result: unknown;

    switch (method) {
      case 'getMe': {
        result = { id: 123_456, username: 'artsem_automation_bot' };
        break;
      }

      case 'getWebhookInfo': {
        result = { pending_update_count: 2, url: webhookUrl };
        break;
      }

      case 'setWebhook': {
        webhookUrl = String(body.url);
        result = true;
        break;
      }

      case 'sendMessage': {
        result = { message_id: 33 };
        break;
      }

      case 'getUpdates': {
        result = [{ message: { chat: { id: 1234, type: 'private' } }, update_id: 1 }];
        break;
      }

      default: {
        throw new Error('Unexpected Bot API method');
      }
    }

    return Promise.resolve(Response.json({ ok: true, result }));
  });
  const deps = {
    client: new TelegramClient({ fetch, token: botToken }),
    print: vi.fn(),
    saveChat: vi.fn().mockImplementation(() => Promise.resolve()),
  };

  return { calls, deps, fetch };
}

describe('hub-only Telegram setup', () => {
  it('refuses to replace a competing webhook without explicit --replace', async () => {
    const h = harness('https://other.example/api/webhook');
    expect(await runTelegramSetup([], env, h.deps)).toBe(1);
    expect(h.calls.some((call) => call.method === 'setWebhook')).toBe(false);
    expect(h.deps.print).toHaveBeenCalledWith(expect.stringContaining('--replace'));
  });

  it('sets the exact hub URL and retains pending updates during replacement', async () => {
    const h = harness('https://backup.example/api/telegram/webhook');
    expect(await runTelegramSetup(['--replace'], env, h.deps)).toBe(0);
    expect(h.calls.find((call) => call.method === 'setWebhook')?.body).toEqual({
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      url: 'https://telegram-webhook-hub.vercel.app/api/webhook',
    });
    expect(h.deps.print.mock.calls.flat().join('\n')).not.toContain(botToken);
  });

  it('renews the secret for its own webhook without requiring --replace', async () => {
    const h = harness('https://telegram-webhook-hub.vercel.app/api/webhook');
    expect(await runTelegramSetup([], env, h.deps)).toBe(0);
    expect(h.calls.filter((call) => call.method === 'setWebhook')).toHaveLength(1);
  });

  it('prints webhook info without exposing token-shaped paths or query credentials', async () => {
    const h = harness(`https://other.example/${'x'.repeat(40)}?token=private`);
    expect(await runTelegramSetup(['--info'], env, h.deps)).toBe(0);
    const output = h.deps.print.mock.calls.flat().join('\n');
    expect(output).toContain('[redacted]');
    expect(output).not.toContain('private');
    expect(output).not.toContain('x'.repeat(40));
    expect(h.calls.some((call) => call.method === 'setWebhook')).toBe(false);
  });

  it.each(['--info', 'register'])('hides all existing webhook paths during %s', async (mode) => {
    for (const path of [`bot${botToken}`, encodeURIComponent(botToken), 'short-private-key']) {
      const h = harness(`https://user:password@other.example/${path}?token=private#secret`);

      expect(await runTelegramSetup(mode === '--info' ? [mode] : [], env, h.deps)).toBe(
        mode === '--info' ? 0 : 1,
      );
      const output = h.deps.print.mock.calls.flat().join('\n');
      expect(output).toContain('https://other.example/[redacted]');

      for (const value of [botToken, path, 'password', 'private', 'secret']) {
        expect(output).not.toContain(value);
      }

      expect(h.calls.some((call) => call.method === 'setWebhook')).toBe(false);
    }
  });

  it('finds and saves one private chat only before webhook ownership is configured', async () => {
    const h = harness();
    expect(await runTelegramSetup(['--find-chat'], env, h.deps)).toBe(0);
    expect(h.deps.saveChat).toHaveBeenCalledWith('1234');
    const owned = harness('https://other.example');
    expect(await runTelegramSetup(['--find-chat'], env, owned.deps)).toBe(1);
    expect(owned.calls.some((call) => call.method === 'getUpdates')).toBe(false);
  });

  it('sends a namespaced test Status button', async () => {
    const h = harness();
    expect(await runTelegramSetup(['--test'], env, h.deps)).toBe(0);
    expect(h.calls.find((call) => call.method === 'sendMessage')?.body).toMatchObject({
      chat_id: '1234',
      reply_markup: { inline_keyboard: [[{ callback_data: 'nb-prod:s:', text: 'Status' }]] },
    });
    expect(h.calls.some((call) => call.method === 'setWebhook')).toBe(false);
  });

  it.each([['--test', '--replace'], ['--test', '--info'], ['--unknown'], ['--test', '--test']])(
    'rejects incompatible or unknown arguments',
    async (...args) => {
      const h = harness();
      expect(await runTelegramSetup(args, env, h.deps)).toBe(1);
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );
});
