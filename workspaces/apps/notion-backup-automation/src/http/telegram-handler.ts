import { integrationUpdateSchema } from '@workspaces/telegram-contracts';

import { ConfigError } from '../config/env.js';
import type { Logger } from '../shared/logger.js';
import type { TelegramWebhook } from '../telegram/webhook.js';
import { configIncomplete, errorResponse, jsonResponse } from './responses.js';
import { isTelegramRequest } from './telegram-auth.js';

const MAX_BODY_BYTES = 64 * 1024;

export interface TelegramHandlerDeps {
  readonly logger: Logger;
  readonly webhook: () => Pick<TelegramWebhook, 'handle'>;
  readonly webhookSecret: string;
}

/** Authenticated commands from the hub. Transient failures remain retryable. */
export async function handleTelegramRequest(
  request: Request,
  deps: TelegramHandlerDeps,
): Promise<Response> {
  if (!isTelegramRequest(request, deps.webhookSecret)) {
    deps.logger.warn('telegram.unauthorized');

    return errorResponse(401, 'UNAUTHORIZED');
  }

  if (request.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', { Allow: 'POST' });
  }

  let body: unknown;

  try {
    const text = await request.text();

    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      return errorResponse(413, 'BODY_TOO_LARGE');
    }

    body = JSON.parse(text) as unknown;
  } catch {
    return errorResponse(400, 'INVALID_UPDATE');
  }

  const parsed = integrationUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(400, 'INVALID_UPDATE');
  }

  try {
    await deps.webhook().handle(parsed.data);
  } catch (error) {
    if (error instanceof ConfigError) {
      deps.logger.error('telegram.config_incomplete', {
        invalid: error.invalid,
        missing: error.missing,
      });

      return configIncomplete();
    }

    deps.logger.error('telegram.failed', { error });

    return errorResponse(503, 'INTEGRATION_UNAVAILABLE');
  }

  return jsonResponse(200, { ok: true });
}
