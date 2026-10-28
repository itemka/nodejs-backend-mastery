import { vi } from 'vitest';

import type { Integration } from '../src/config/env.js';
import type { DeliveryState } from '../src/ports.js';

export const secret = 'w'.repeat(40);
export const integrationToken = 'i'.repeat(40);
export const botToken = ['123456', 'b'.repeat(35)].join(':');
export const integration: Integration = {
  commands: ['status', 'backup_status'],
  id: 'nb-prod',
  token: integrationToken,
  url: 'https://backup.example/api/integrations/telegram',
};
export const env: NodeJS.ProcessEnv = {
  APP_BASE_URL: 'https://telegram-webhook-hub.vercel.app',
  HUB_INTEGRATIONS: JSON.stringify([integration]),
  HUB_LEGACY_INTEGRATION_ID: 'nb-prod',
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_CHAT_ID: '1234',
  TELEGRAM_WEBHOOK_SECRET: secret,
  UPSTASH_REDIS_REST_TOKEN: 'r'.repeat(40),
  UPSTASH_REDIS_REST_URL: 'https://redis.example',
};

export class FakeState implements DeliveryState {
  readonly done = new Set<number>();
  readonly locks = new Map<number, string>();
  readonly counted = new Set<number>();
  denied = false;

  claim(updateId: number, token: string): Promise<'busy' | 'claimed' | 'done'> {
    if (this.done.has(updateId)) return Promise.resolve('done');
    if (this.locks.has(updateId)) return Promise.resolve('busy');
    this.locks.set(updateId, token);

    return Promise.resolve('claimed');
  }

  complete(updateId: number, token: string): Promise<void> {
    if (this.locks.get(updateId) !== token) return Promise.reject(new Error('Lease lost'));
    this.done.add(updateId);
    this.locks.delete(updateId);

    return Promise.resolve();
  }

  release(updateId: number, token: string): Promise<void> {
    if (this.locks.get(updateId) === token) this.locks.delete(updateId);

    return Promise.resolve();
  }

  allow(updateId: number): Promise<boolean> {
    if (this.counted.has(updateId)) return Promise.resolve(true);
    if (this.denied) return Promise.resolve(false);
    this.counted.add(updateId);

    return Promise.resolve(true);
  }
}

export function fakeClient() {
  return {
    answerCallbackQuery: vi.fn().mockImplementation(() => Promise.resolve()),
    removeButtons: vi.fn().mockImplementation(() => Promise.resolve()),
    sendMessage: vi.fn().mockResolvedValue({ messageId: 88 }),
  };
}

export function update(text = '/status', updateId = 1) {
  return {
    message: { chat: { id: 1234, type: 'private' }, from: { id: 1234 }, text },
    update_id: updateId,
  };
}

export function callback(data = 'nb-prod:s:2026-10', updateId = 1) {
  return {
    callback_query: {
      data,
      from: { id: 1234 },
      id: 'callback-1',
      message: { chat: { id: 1234, type: 'private' }, message_id: 42 },
    },
    update_id: updateId,
  };
}

export function webhookRequest(body: unknown, header: string | undefined = secret) {
  return new Request('https://hub.example/api/webhook', {
    body: JSON.stringify(body),
    headers: header === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': header },
    method: 'POST',
  });
}

export function messageRequest(body: unknown, token = integrationToken) {
  return new Request('https://hub.example/api/messages', {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
  });
}

export async function statusOf(responsePromise: Promise<Response>): Promise<number> {
  const response = await responsePromise;

  return response.status;
}

export function bodyText(options: RequestInit | undefined): string {
  if (typeof options?.body !== 'string') {
    throw new TypeError('Expected a JSON string body');
  }

  return options.body;
}
