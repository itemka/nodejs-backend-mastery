import type { TelegramMessage } from '@workspaces/telegram-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  serveMessages,
  serveWebhook,
} from '../../../telegram-webhook-hub/src/config/containers.js';
import type { BotClient, DeliveryState } from '../../../telegram-webhook-hub/src/ports.js';
import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisTelegramState } from '../../src/adapters/persistence/redis-telegram-state.js';
import { TelegramClient } from '../../src/adapters/telegram/telegram-client.js';
import { handleTelegramRequest } from '../../src/http/telegram-handler.js';
import { SecretValue } from '../../src/shared/secret-value.js';
import { TelegramWebhook } from '../../src/telegram/webhook.js';
import { backupHarness } from '../support/backup-harness.js';
import { FakeRedis } from '../support/fake-redis.js';

const CHAT_ID = 424_242;
const HUB_URL = 'https://hub.example.test';
const BACKUP_URL = 'https://backup.example.test/api/integrations/telegram';
const routeToken = `integration-${'a'.repeat(40)}`;
const webhookSecret = 'b'.repeat(64);

/** Test storage boundary; Redis lease semantics are tested in the hub adapter suite. */
class MemoryDeliveryState implements DeliveryState {
  readonly done = new Set<number>();
  readonly processing = new Map<number, string>();

  claim(id: number, token: string): Promise<'busy' | 'claimed' | 'done'> {
    if (this.done.has(id)) return Promise.resolve('done');
    if (this.processing.has(id)) return Promise.resolve('busy');
    this.processing.set(id, token);

    return Promise.resolve('claimed');
  }

  complete(id: number, token: string): Promise<void> {
    if (this.processing.get(id) !== token) return Promise.reject(new Error('Lease lost'));
    this.processing.delete(id);
    this.done.add(id);

    return Promise.resolve();
  }

  release(id: number, token: string): Promise<void> {
    if (this.processing.get(id) === token) this.processing.delete(id);

    return Promise.resolve();
  }

  allow(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class RecordingBot implements BotClient {
  readonly messages: { chatId: string; message: TelegramMessage; messageId: number }[] = [];
  readonly answers: { callbackId: string; text?: string }[] = [];
  readonly removed: number[] = [];

  sendMessage(chatId: string, message: TelegramMessage): Promise<{ messageId: number }> {
    const messageId = 100 + this.messages.length;
    this.messages.push({ chatId, message, messageId });

    return Promise.resolve({ messageId });
  }

  answerCallbackQuery(callbackId: string, text?: string): Promise<void> {
    this.answers.push({ callbackId, ...(text === undefined ? {} : { text }) });

    return Promise.resolve();
  }

  removeButtons(_chatId: string, messageId: number): Promise<void> {
    this.removed.push(messageId);

    return Promise.resolve();
  }
}

function integratedHarness() {
  const backup = backupHarness();
  const bot = new RecordingBot();
  const state = new MemoryDeliveryState();
  const redis = new FakeRedis();
  const transport = { backupOffline: false, forwarded: 0, loseNextResponse: false };
  const source = {
    HUB_INTEGRATIONS: JSON.stringify([
      { commands: ['status', 'backup_status'], id: 'nb-prod', token: routeToken, url: BACKUP_URL },
    ]),
    HUB_LEGACY_INTEGRATION_ID: 'nb-prod',
    TELEGRAM_BOT_TOKEN: `123456789:${'c'.repeat(35)}`,
    TELEGRAM_CHAT_ID: String(CHAT_ID),
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    UPSTASH_REDIS_REST_TOKEN: 'unused-redis-token',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
  };

  const network: typeof fetch = async (input, init) => {
    const request = new Request(input, init);

    if (request.url === `${HUB_URL}/api/messages`) {
      return serveMessages(request, source, { client: bot, state });
    }

    if (request.url === BACKUP_URL) {
      if (transport.backupOffline) throw new TypeError('Backend unavailable');
      transport.forwarded++;
      const response = await handleTelegramRequest(request, {
        logger: backup.logger,
        webhook: () => integration,
        webhookSecret: routeToken,
      });

      if (transport.loseNextResponse) {
        transport.loseNextResponse = false;
        await response.body?.cancel();
        throw new TypeError('Response lost after processing');
      }

      return response;
    }

    throw new Error('Unexpected network destination');
  };

  const integration = new TelegramWebhook({
    client: new TelegramClient({
      fetch: network,
      hubUrl: HUB_URL,
      integrationId: 'nb-prod',
      token: new SecretValue(routeToken),
    }),
    format: { appEnv: 'prod', timeZone: 'Europe/Warsaw' },
    ids: backup.ids,
    logger: backup.logger,
    policy: backup.policy,
    service: backup.service,
    state: new RedisTelegramState(redis, keyPrefixFor('test'), backup.clock),
  });

  const send = (update: unknown) =>
    serveWebhook(
      new Request(`${HUB_URL}/api/webhook`, {
        body: JSON.stringify(update),
        headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret },
        method: 'POST',
      }),
      source,
      { client: bot, fetch: network, state },
    );
  const message = (id: number, text: string) =>
    send({
      message: { chat: { id: CHAT_ID, type: 'private' }, from: { id: CHAT_ID }, text },
      update_id: id,
    });
  const tap = (id: number, data: string, messageId = 10) =>
    send({
      callback_query: {
        data,
        from: { id: CHAT_ID },
        id: `tap-${id}`,
        message: { chat: { id: CHAT_ID, type: 'private' }, message_id: messageId },
      },
      update_id: id,
    });

  return { backup, bot, message, state, tap, transport };
}

describe('Telegram hub ↔ backup HTTP integration', () => {
  it('routes status through both authenticated boundaries and sends namespaced buttons back', async () => {
    const h = integratedHarness();
    await h.backup.service.start();

    await expect(h.message(1, '/status')).resolves.toHaveProperty('status', 200);
    await expect(h.message(2, '/backup_status')).resolves.toHaveProperty('status', 200);
    expect(h.transport.forwarded).toBe(2);
    expect(h.bot.messages).toHaveLength(2);
    expect(h.bot.messages[0]?.chatId).toBe(String(CHAT_ID));
    expect(h.bot.messages[0]?.message.html).toContain('Job 2026-10');
    expect(h.bot.messages[0]?.message.buttons?.flat()).toContainEqual({
      callbackData: 'nb-prod:s:2026-10',
      text: 'Status',
    });
  });

  it('keeps legacy buttons usable and confirms cancellation once through the hub', async () => {
    const h = integratedHarness();
    await h.backup.service.start();
    const cancel = vi.spyOn(h.backup.service, 'cancel');

    await expect(h.tap(10, 'x:2026-10')).resolves.toHaveProperty('status', 200);
    expect(cancel).not.toHaveBeenCalled();
    const confirmation = h.bot.messages.at(-1);
    const button = confirmation?.message.buttons?.flat().find((item) => 'callbackData' in item);
    if (button === undefined || !('callbackData' in button)) throw new Error('No confirmation');
    expect(button.callbackData).toMatch(/^nb-prod:c:/);

    await expect(h.tap(11, button.callbackData, confirmation?.messageId)).resolves.toHaveProperty(
      'status',
      200,
    );
    await expect(h.tap(12, button.callbackData, confirmation?.messageId)).resolves.toHaveProperty(
      'status',
      200,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(h.backup.service.status('2026-10')).resolves.toHaveProperty(
      'job.status',
      'CANCELLED',
    );
    expect(h.bot.removed).toContain(10);
    expect(h.bot.answers).toHaveLength(3);
  });

  it('retries the same update after a backend outage without losing its command', async () => {
    const h = integratedHarness();
    h.transport.backupOffline = true;
    await expect(h.message(20, '/status')).resolves.toHaveProperty('status', 503);
    expect(h.state.done.has(20)).toBe(false);

    h.transport.backupOffline = false;
    await expect(h.message(20, '/status')).resolves.toHaveProperty('status', 200);
    expect(h.bot.messages.map((item) => item.message.html)).toEqual(['No backup job exists yet.']);
    expect(h.state.done.has(20)).toBe(true);
  });

  it('survives a lost backend response without repeating a completed action or reply', async () => {
    const h = integratedHarness();
    await h.backup.service.start();
    const cancel = vi.spyOn(h.backup.service, 'cancel');
    await h.tap(30, 'nb-prod:x:2026-10');
    const confirmation = h.bot.messages.at(-1);
    const button = confirmation?.message.buttons?.flat().find((item) => 'callbackData' in item);
    if (button === undefined || !('callbackData' in button)) throw new Error('No confirmation');

    h.transport.loseNextResponse = true;
    await expect(h.tap(31, button.callbackData, confirmation?.messageId)).resolves.toHaveProperty(
      'status',
      503,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.bot.messages).toHaveLength(2);
    await expect(h.tap(31, button.callbackData, confirmation?.messageId)).resolves.toHaveProperty(
      'status',
      200,
    );
    expect(h.transport.forwarded).toBe(3);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.bot.messages).toHaveLength(2);
  });

  it('retries a confirmed action after a transient backup read failure', async () => {
    const h = integratedHarness();
    await h.backup.service.start();
    const cancel = vi.spyOn(h.backup.service, 'cancel');
    await h.tap(50, 'nb-prod:x:2026-10');
    const confirmation = h.bot.messages.at(-1);
    const button = confirmation?.message.buttons?.flat().find((item) => 'callbackData' in item);
    if (button === undefined || !('callbackData' in button)) throw new Error('No confirmation');

    vi.spyOn(h.backup.service, 'status').mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(h.tap(51, button.callbackData, confirmation?.messageId)).resolves.toHaveProperty(
      'status',
      503,
    );
    expect(cancel).not.toHaveBeenCalled();
    await expect(h.tap(51, button.callbackData, confirmation?.messageId)).resolves.toHaveProperty(
      'status',
      200,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses an unconfigured development namespace instead of touching production', async () => {
    const h = integratedHarness();
    await expect(h.tap(40, 'nb-dev:x:2026-10')).resolves.toHaveProperty('status', 200);
    expect(h.transport.forwarded).toBe(0);
    expect(h.bot.answers[0]?.text).toContain('Unknown');
  });
});
