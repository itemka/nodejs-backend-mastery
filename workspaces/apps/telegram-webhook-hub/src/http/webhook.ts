import type { IntegrationUpdate } from '@workspaces/telegram-contracts';
import { integrationUpdateSchema, MAX_MESSAGE_LENGTH } from '@workspaces/telegram-contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { TelegramApiError } from '../adapters/telegram-client.js';
import type { Integration } from '../config/env.js';
import type { BotClient, DeliveryState } from '../ports.js';
import { isPermanentRefusal, json, readJson, secretEquals } from './shared.js';

const personSchema = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const chatSchema = z.object({
  id: z.number().int().max(Number.MAX_SAFE_INTEGER),
  type: z.string().optional(),
});
const updateSchema = z.object({
  callback_query: z
    .object({
      data: z.string().max(64).optional(),
      from: personSchema,
      id: z.string().min(1).max(100),
      message: z.object({ chat: chatSchema, message_id: z.number().int().positive() }).optional(),
    })
    .optional(),
  message: z
    .object({ chat: chatSchema, from: personSchema, text: z.string().max(4096).optional() })
    .optional(),
  update_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export interface WebhookDeps {
  readonly chatId: string;
  readonly client: BotClient;
  readonly fetch: typeof fetch;
  readonly integrations: readonly Integration[];
  readonly legacyIntegrationId?: string;
  readonly state: DeliveryState;
  readonly webhookSecret: string;
}

export function parseTelegramUpdate(body: unknown, chatId: string): IntegrationUpdate | undefined {
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return undefined;
  }

  const { callback_query: callback, message, update_id: updateId } = parsed.data;
  const yours = (id: number) => String(id) === chatId;

  if (
    message !== undefined &&
    yours(message.from.id) &&
    yours(message.chat.id) &&
    (message.chat.type === undefined || message.chat.type === 'private')
  ) {
    return { input: { kind: 'message', text: message.text ?? '' }, updateId };
  }

  if (
    callback !== undefined &&
    yours(callback.from.id) &&
    (callback.message === undefined ||
      (yours(callback.message.chat.id) &&
        (callback.message.chat.type === undefined || callback.message.chat.type === 'private')))
  ) {
    const normalized = integrationUpdateSchema.safeParse({
      input: {
        callbackId: callback.id,
        data: callback.data ?? '',
        kind: 'callback',
        ...(callback.message === undefined ? {} : { messageId: callback.message.message_id }),
      },
      updateId,
    });

    return normalized.success ? normalized.data : undefined;
  }

  return undefined;
}

function routeUpdate(
  update: IntegrationUpdate,
  deps: WebhookDeps,
): { integration: Integration; update: IntegrationUpdate } | undefined {
  if (update.input.kind === 'message') {
    const text = update.input.text.trim();
    const command = text.startsWith('/')
      ? text.split(/\s+/, 1)[0]?.toLowerCase().replace(/@\w+$/, '').slice(1)
      : undefined;
    const integration = deps.integrations.find((route) => route.commands.includes(command ?? ''));

    return integration === undefined ? undefined : { integration, update };
  }

  const separator = update.input.data.indexOf(':');

  if (separator < 1) {
    return undefined;
  }

  const prefix = update.input.data.slice(0, separator);
  const integration = deps.integrations.find((route) => route.id === prefix);

  if (integration !== undefined) {
    const forwarded = integrationUpdateSchema.safeParse({
      ...update,
      input: { ...update.input, data: update.input.data.slice(separator + 1) },
    });

    return forwarded.success ? { integration, update: forwarded.data } : undefined;
  }

  if (/^[srfxlc]:[\w:-]*$/.test(update.input.data)) {
    const legacy = deps.integrations.find((route) => route.id === deps.legacyIntegrationId);

    return legacy === undefined ? undefined : { integration: legacy, update };
  }

  return undefined;
}

/** Keep every configured command visible without exceeding the message contract. */
function helpPages(integrations: readonly Integration[]): string[] {
  const header = 'Artsem Automation Hub\nCommands: ';
  const pages: string[] = [];
  let page = header;

  for (const integration of integrations) {
    for (const command of integration.commands) {
      const entry = `/${command}`;
      const separator = page === header ? '' : ' · ';

      if (page.length + separator.length + entry.length > MAX_MESSAGE_LENGTH) {
        pages.push(page);
        page = header + entry;
      } else {
        page += separator + entry;
      }
    }
  }

  pages.push(page);

  return pages;
}

export async function handleWebhookRequest(request: Request, deps: WebhookDeps): Promise<Response> {
  if (!secretEquals(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), deps.webhookSecret)) {
    return json(401, { code: 'UNAUTHORIZED' });
  }

  if (request.method !== 'POST') {
    return json(405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
  }

  const update = parseTelegramUpdate(await readJson(request), deps.chatId);

  if (update === undefined) {
    return json(200, { ok: true });
  }

  const token = randomUUID();
  let claimed = false;

  try {
    const claim = await deps.state.claim(update.updateId, token);

    if (claim === 'done') {
      return json(200, { ok: true });
    }

    if (claim === 'busy') {
      return json(503, { code: 'DELIVERY_IN_PROGRESS' }, { 'Retry-After': '5' });
    }

    claimed = true;

    if (!(await deps.state.allow(update.updateId))) {
      if (update.input.kind === 'callback') {
        await answerRejectedCallback(
          deps.client,
          update.input.callbackId,
          'Too many requests this hour; try again later',
        );
      }

      await deps.state.complete(update.updateId, token);

      return json(200, { ok: true });
    }

    const route = routeUpdate(update, deps);

    if (route === undefined) {
      if (update.input.kind === 'callback') {
        await answerRejectedCallback(
          deps.client,
          update.input.callbackId,
          'Unknown or unavailable integration',
        );
      } else {
        for (const html of helpPages(deps.integrations)) {
          await deps.client.sendMessage(deps.chatId, { html });
        }
      }
    } else {
      const response = await deps.fetch(route.integration.url, {
        body: JSON.stringify(route.update),
        headers: {
          authorization: `Bearer ${route.integration.token}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      await response.body?.cancel();

      if (isPermanentRefusal(response.status)) {
        await notifyRefused(deps, update, route.integration.id);
      } else if (!response.ok) {
        throw new Error('Integration unavailable');
      }
    }

    await deps.state.complete(update.updateId, token);

    return json(200, { ok: true });
  } catch {
    if (claimed) {
      try {
        await deps.state.release(update.updateId, token);
      } catch {
        // The 60-second lease still expires if Redis is temporarily unavailable.
      }
    }

    return json(503, { code: 'DELIVERY_UNAVAILABLE' }, { 'Retry-After': '5' });
  }
}

/**
 * An integration refused the update with a 4xx, such as a contract it does not know or a token
 * it does not accept. A resend gets the same answer, so the update is finished with a notice.
 */
async function notifyRefused(
  deps: WebhookDeps,
  update: IntegrationUpdate,
  integrationId: string,
): Promise<void> {
  await (update.input.kind === 'callback'
    ? answerRejectedCallback(
        deps.client,
        update.input.callbackId,
        `${integrationId} could not handle this button`,
      )
    : deps.client.sendMessage(deps.chatId, {
        html: `${integrationId} could not handle this command; check its deployment.`,
      }));
}

/** An expired query cannot become answerable by redelivering a rejected update. */
async function answerRejectedCallback(
  client: BotClient,
  callbackId: string,
  text: string,
): Promise<void> {
  try {
    await client.answerCallbackQuery(callbackId, text);
  } catch (error) {
    if (
      !(error instanceof TelegramApiError && error.failure === 'api' && error.errorCode === 400)
    ) {
      throw error;
    }
  }
}
