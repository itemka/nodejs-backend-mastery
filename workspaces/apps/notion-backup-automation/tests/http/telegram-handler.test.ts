import { describe, expect, it, vi } from 'vitest';

import { ConfigError } from '../../src/config/env.js';
import { handleTelegramRequest } from '../../src/http/telegram-handler.js';
import { createLogger } from '../../src/shared/logger.js';
import { fakeHubToken } from '../support/fake-telegram.js';

const body = { input: { kind: 'message', text: '/status' }, updateId: 1 };

function request(
  token: string | undefined = fakeHubToken,
  payload: unknown = body,
  method = 'POST',
) {
  return new Request('https://nba.example/api/integrations/telegram', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    method,
    ...(method === 'POST'
      ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }
      : {}),
  });
}

function setup() {
  const handle = vi.fn().mockResolvedValue('handled');
  const webhook = vi.fn(() => ({ handle }));

  return {
    deps: { logger: createLogger({ sink: vi.fn() }), webhook, webhookSecret: fakeHubToken },
    handle,
    webhook,
  };
}

async function status(
  requestValue: Request,
  deps: Parameters<typeof handleTelegramRequest>[1],
): Promise<number> {
  const response = await handleTelegramRequest(requestValue, deps);

  return response.status;
}

describe('POST /api/integrations/telegram', () => {
  it('authenticates before constructing any services or reading the payload', async () => {
    const { deps, webhook } = setup();

    for (const token of ['', 'wrong', fakeHubToken + 'x']) {
      expect(await status(request(token, 'not json'), deps)).toBe(401);
    }

    expect(webhook).not.toHaveBeenCalled();
  });

  it('forwards only a validated normalized update', async () => {
    const { deps, handle } = setup();
    expect(await status(request(), deps)).toBe(200);
    expect(handle).toHaveBeenCalledWith(body);
  });

  it('refuses malformed, raw Telegram, extra-field and oversized payloads before construction', async () => {
    const { deps, webhook } = setup();

    for (const payload of [
      'not json',
      { update_id: 1 },
      { ...body, chatId: 10 },
      { input: { callbackId: 'x', data: 'x'.repeat(65), kind: 'callback' }, updateId: 1 },
    ]) {
      expect(await status(request(fakeHubToken, payload), deps)).toBe(400);
    }

    expect(await status(request(fakeHubToken, 'x'.repeat(70_000)), deps)).toBe(413);
    expect(webhook).not.toHaveBeenCalled();
  });

  it('returns retryable 503 on transient failures and configuration gaps', async () => {
    const { deps, handle, webhook } = setup();
    handle.mockRejectedValueOnce(new Error('temporary'));
    expect(await status(request(), deps)).toBe(503);
    webhook.mockImplementationOnce(() => {
      throw new ConfigError(['TELEGRAM_HUB_URL'], []);
    });
    expect(await status(request(), deps)).toBe(503);
  });

  it('accepts POST only', async () => {
    const { deps } = setup();
    expect(await status(request(fakeHubToken, '', 'GET'), deps)).toBe(405);
  });
});
