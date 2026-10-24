import * as ui from '@workspaces/cli-output';
import path from 'node:path';

import { testMessage } from '../../adapters/telegram/message-formats.js';
import type { TelegramChat } from '../../adapters/telegram/telegram-client.js';
import { TelegramApiError, TelegramClient } from '../../adapters/telegram/telegram-client.js';
import { loadEnv, telegramBotEnvSchema, telegramChatEnvSchema } from '../../config/env.js';
import { upsertEnvFile } from '../../shared/env-file.js';
import { SecretValue } from '../../shared/secret-value.js';
import type { CliContext } from '../context.js';
import { fetchOption } from '../context.js';

export type TelegramSetupMode = 'find-chat' | 'info' | 'test';

/** A path segment this long and token-shaped may be another app's webhook secret. */
const secretSegmentPattern = /^[\w-]{24,}$/;

/**
 * `telegram:setup --find-chat | --test | --info`. The bot token never appears in the output.
 * Setting the webhook comes with the webhook endpoint.
 */
export async function runTelegramSetup(
  { mode }: { mode: TelegramSetupMode },
  context: CliContext,
): Promise<number> {
  switch (mode) {
    case 'find-chat': {
      return findChat(context);
    }

    case 'info': {
      return showInfo(context);
    }

    case 'test': {
      return sendTest(context);
    }
  }
}

function createClient(context: CliContext, token: string): TelegramClient {
  return new TelegramClient({ token: new SecretValue(token), ...fetchOption(context) });
}

/**
 * After you send `/start` to the bot: reads the pending messages (without confirming them) and
 * saves the one private chat's ID as `TELEGRAM_CHAT_ID`. Works only while no webhook is set.
 */
async function findChat(context: CliContext): Promise<number> {
  const env = loadEnv(telegramBotEnvSchema, context.env);
  const client = createClient(context, env.TELEGRAM_BOT_TOKEN);
  const bot = await client.getMe();
  const botName = bot.username === undefined ? `bot ${bot.id}` : `@${bot.username}`;

  context.print(ui.heading(`Telegram chat with ${botName}`));

  let updates;

  try {
    updates = await client.getUpdates();
  } catch (error) {
    if (error instanceof TelegramApiError && error.errorCode === 409) {
      context.print(
        ui.fail(
          'A webhook receives this bot’s updates, so they cannot be read here. Run telegram:setup --info.',
        ),
      );

      return 1;
    }

    throw error;
  }

  const chats = new Map<number, TelegramChat>();

  for (const { chat } of updates) {
    if (chat?.type === 'private') {
      chats.set(chat.id, chat);
    }
  }

  if (chats.size === 0) {
    context.print(
      ui.fail(
        `No private message to ${botName} is waiting. Send /start to the bot in Telegram, then run this again.`,
      ),
    );

    return 1;
  }

  for (const chat of chats.values()) {
    context.print(`  chat ${chat.id}  ${chatName(chat)}`);
  }

  const [only, ...others] = [...chats.values()];

  if (only === undefined || others.length > 0) {
    context.print(
      ui.warn(
        'More than one private chat wrote to the bot. Set TELEGRAM_CHAT_ID to yours in .env.local by hand.',
      ),
    );

    return 1;
  }

  await upsertEnvFile(context.envFilePath, { TELEGRAM_CHAT_ID: String(only.id) });
  context.print(
    ui.ok(`Saved TELEGRAM_CHAT_ID to ${path.basename(context.envFilePath)} (mode 0600)`),
  );
  context.print('Next: copy TELEGRAM_CHAT_ID into 1Password, then run telegram:setup --test.');

  return 0;
}

/** Read-only: who holds the bot's updates. Prints the webhook's host and path, never a query. */
async function showInfo(context: CliContext): Promise<number> {
  const env = loadEnv(telegramBotEnvSchema, context.env);
  const client = createClient(context, env.TELEGRAM_BOT_TOKEN);
  const bot = await client.getMe();
  const info = await client.getWebhookInfo();

  context.print(
    ui.heading(`Telegram bot ${bot.username === undefined ? bot.id : `@${bot.username}`}`),
  );

  if (info.url === '') {
    context.print(
      ui.ok('No webhook is set: no app receives the bot’s updates, and getUpdates works.'),
    );
  } else {
    context.print(`  webhook       ${webhookLocation(info.url)}`);
  }

  context.print(`  pending       ${info.pendingUpdateCount} updates`);

  if (info.lastErrorAt !== undefined) {
    context.print(
      ui.warn(
        `  last error    ${info.lastErrorAt.toISOString()} ${info.lastErrorMessage ?? ''}`.trimEnd(),
      ),
    );
  }

  return 0;
}

/** Sends the test message, with a Status button, to `TELEGRAM_CHAT_ID`. */
async function sendTest(context: CliContext): Promise<number> {
  const env = loadEnv(telegramChatEnvSchema, context.env);
  const client = createClient(context, env.TELEGRAM_BOT_TOKEN);
  const { messageId } = await client.sendMessage(
    env.TELEGRAM_CHAT_ID,
    testMessage({ appEnv: env.APP_ENV }),
  );

  context.print(ui.heading('Telegram test message'));
  context.print(
    ui.ok(
      `Sent message ${messageId} to chat ${env.TELEGRAM_CHAT_ID}. Check Telegram on your phone.`,
    ),
  );

  return 0;
}

function chatName(chat: TelegramChat): string {
  if (chat.username !== undefined) {
    return `@${chat.username}`;
  }

  return chat.firstName ?? '';
}

/** `https://host/path`; long token-shaped path segments are hidden, and the query is dropped. */
function webhookLocation(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return 'set, but not a readable URL';
  }

  const pathname = url.pathname
    .split('/')
    .map((segment) => (secretSegmentPattern.test(segment) ? '[redacted]' : segment))
    .join('/');

  return `${url.protocol}//${url.host}${pathname}`;
}
