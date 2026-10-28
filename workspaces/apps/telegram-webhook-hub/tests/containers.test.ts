import { beforeEach, describe, expect, it, vi } from 'vitest';

import { serveMessages, serveWebhook } from '../src/config/containers.js';
import { env, messageRequest, secret, statusOf, update, webhookRequest } from './support.js';

const construction = vi.hoisted(() => ({ bot: vi.fn(), redis: vi.fn() }));

vi.mock('../src/adapters/telegram-client.js', () => ({
  TelegramClient: class {
    constructor() {
      construction.bot();
    }
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      construction.redis();
    }
  },
}));

describe('composition root authentication order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs no Bot API or Redis client for a bad Telegram secret', async () => {
    expect(await statusOf(serveWebhook(webhookRequest(update(), 'wrong'), env))).toBe(401);
    expect(construction.bot).not.toHaveBeenCalled();
    expect(construction.redis).not.toHaveBeenCalled();
  });

  it('constructs no Bot API or Redis client for a bad integration token', async () => {
    expect(
      await statusOf(
        serveMessages(
          messageRequest({ action: 'sendMessage', message: { html: 'hello' } }, 'wrong'),
          env,
        ),
      ),
    ).toBe(401);
    expect(construction.bot).not.toHaveBeenCalled();
    expect(construction.redis).not.toHaveBeenCalled();
  });

  it('fails closed with missing webhook credentials before client construction', async () => {
    expect(await statusOf(serveWebhook(webhookRequest(update()), {}))).toBe(503);
    expect(construction.bot).not.toHaveBeenCalled();
    expect(construction.redis).not.toHaveBeenCalled();
  });

  it('fails closed after authentication when runtime configuration is incomplete', async () => {
    expect(
      await statusOf(serveWebhook(webhookRequest(update()), { TELEGRAM_WEBHOOK_SECRET: secret })),
    ).toBe(503);
    expect(construction.bot).not.toHaveBeenCalled();
    expect(construction.redis).not.toHaveBeenCalled();
  });
});
