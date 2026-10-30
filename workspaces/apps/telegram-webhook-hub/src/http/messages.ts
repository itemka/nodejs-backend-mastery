import { hubOperationSchema } from '@workspaces/telegram-contracts';

import { TelegramApiError } from '../adapters/telegram-client.js';
import type { Integration } from '../config/env.js';
import type { BotClient } from '../ports.js';
import { isPermanentRefusal, json, readJson, secretEquals } from './shared.js';

export interface MessagesDeps {
  readonly chatId: string;
  readonly client: BotClient;
  /** The caller, as `authorizedIntegration` found it. */
  readonly integration: Integration;
}

export function authorizedIntegration(
  request: Request,
  integrations: readonly Integration[],
): Integration | undefined {
  const bearer = request.headers.get('authorization');

  return integrations.find((integration) => secretEquals(bearer, `Bearer ${integration.token}`));
}

/** A `POST` from an integration that `serveMessages` has already authenticated. */
export async function handleMessagesRequest(
  request: Request,
  deps: MessagesDeps,
): Promise<Response> {
  const { integration } = deps;
  const parsed = hubOperationSchema.safeParse(await readJson(request));

  if (!parsed.success) {
    return json(400, { code: 'INVALID_OPERATION' });
  }

  const operation = parsed.data;

  if (
    operation.action === 'sendMessage' &&
    operation.message.buttons?.some((row) =>
      row.some(
        (button) =>
          'callbackData' in button && !button.callbackData.startsWith(`${integration.id}:`),
      ),
    )
  ) {
    return json(403, { code: 'CALLBACK_NAMESPACE_FORBIDDEN' });
  }

  try {
    switch (operation.action) {
      case 'sendMessage': {
        return json(
          200,
          await deps.client.sendMessage(deps.chatId, {
            ...(operation.message.buttons === undefined
              ? {}
              : { buttons: operation.message.buttons }),
            html: operation.message.html,
          }),
        );
      }

      case 'removeButtons': {
        await deps.client.removeButtons(deps.chatId, operation.messageId);
        break;
      }

      case 'answerCallbackQuery': {
        await deps.client.answerCallbackQuery(operation.callbackId, operation.text);
        break;
      }
    }

    return json(200, { ok: true });
  } catch (error) {
    // Telegram's own 4xx (bad markup, a blocked bot, an expired query) does not change on a
    // resend, so the integration can finish the update instead of retrying it.
    if (
      error instanceof TelegramApiError &&
      error.failure === 'api' &&
      error.errorCode !== undefined &&
      isPermanentRefusal(error.errorCode)
    ) {
      return json(422, { code: 'TELEGRAM_REJECTED' });
    }

    return json(503, { code: 'TELEGRAM_UNAVAILABLE' });
  }
}
