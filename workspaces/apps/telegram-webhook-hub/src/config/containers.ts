import { Redis } from '@upstash/redis';

import { RedisDeliveryState } from '../adapters/redis-state.js';
import type { RedisCommands } from '../adapters/redis-state.js';
import { TelegramClient } from '../adapters/telegram-client.js';
import { authorizedIntegration, handleMessagesRequest } from '../http/messages.js';
import { json, secretEquals } from '../http/shared.js';
import { handleWebhookRequest } from '../http/webhook.js';
import type { BotClient, DeliveryState } from '../ports.js';
import { parseConfig, readIntegrations, runtimeEnvSchema, webhookAuthSchema } from './env.js';

export interface RuntimeOverrides {
  readonly client?: BotClient;
  readonly fetch?: typeof fetch;
  readonly redis?: RedisCommands;
  readonly state?: DeliveryState;
}

export async function serveWebhook(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: RuntimeOverrides = {},
): Promise<Response> {
  try {
    const auth = parseConfig(webhookAuthSchema, source);

    if (
      !secretEquals(
        request.headers.get('X-Telegram-Bot-Api-Secret-Token'),
        auth.TELEGRAM_WEBHOOK_SECRET,
      )
    ) {
      return json(401, { code: 'UNAUTHORIZED' });
    }

    if (request.method !== 'POST') {
      return json(405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
    }

    const env = parseConfig(runtimeEnvSchema, source);
    const fetchImpl = overrides.fetch ?? globalThis.fetch;
    const integrations = readIntegrations(source);
    const redis =
      overrides.redis ??
      new Redis({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL });

    return handleWebhookRequest(request, {
      chatId: env.TELEGRAM_CHAT_ID,
      client:
        overrides.client ?? new TelegramClient({ fetch: fetchImpl, token: env.TELEGRAM_BOT_TOKEN }),
      fetch: fetchImpl,
      integrations,
      ...(source.HUB_LEGACY_INTEGRATION_ID === undefined
        ? {}
        : { legacyIntegrationId: source.HUB_LEGACY_INTEGRATION_ID }),
      state: overrides.state ?? new RedisDeliveryState(redis, env.HUB_KEY_PREFIX),
      webhookSecret: auth.TELEGRAM_WEBHOOK_SECRET,
    });
  } catch {
    return json(503, { code: 'CONFIG_INCOMPLETE' });
  }
}

export async function serveMessages(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
  overrides: RuntimeOverrides = {},
): Promise<Response> {
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) {
    return json(401, { code: 'UNAUTHORIZED' });
  }

  try {
    const integrations = readIntegrations(source);

    if (authorizedIntegration(request, integrations) === undefined) {
      return json(401, { code: 'UNAUTHORIZED' });
    }

    if (request.method !== 'POST') {
      return json(405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
    }

    const env = parseConfig(runtimeEnvSchema, source);

    return handleMessagesRequest(request, {
      chatId: env.TELEGRAM_CHAT_ID,
      client:
        overrides.client ??
        new TelegramClient({
          fetch: overrides.fetch ?? globalThis.fetch,
          token: env.TELEGRAM_BOT_TOKEN,
        }),
      integrations,
    });
  } catch {
    return json(503, { code: 'CONFIG_INCOMPLETE' });
  }
}
