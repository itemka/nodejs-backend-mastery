import type { TelegramClient } from '../adapters/telegram-client.js';
import { TelegramClient as BotApiClient } from '../adapters/telegram-client.js';
import {
  botEnvSchema,
  chatEnvSchema,
  parseConfig,
  readIntegrations,
  setupEnvSchema,
} from '../config/env.js';

export interface SetupDeps {
  readonly client?: TelegramClient;
  readonly fetch?: typeof fetch;
  readonly print: (line: string) => void;
  readonly saveChat: (chatId: string) => Promise<void>;
}

/** An existing webhook can put credentials anywhere in its path; display its origin only. */
function location(raw: string): string {
  const url = new URL(raw);

  return `${url.origin}${url.pathname === '/' ? '' : '/[redacted]'}`;
}

export async function runTelegramSetup(
  args: readonly string[],
  source: NodeJS.ProcessEnv,
  deps: SetupDeps,
): Promise<number> {
  const flags = new Set(args);
  const modes = ['--find-chat', '--test', '--info'].filter((mode) => flags.has(mode));

  if (
    args.some((arg) => !['--find-chat', '--test', '--info', '--replace'].includes(arg)) ||
    modes.length > 1 ||
    (modes.length > 0 && flags.has('--replace')) ||
    flags.size !== args.length
  ) {
    deps.print('Usage: telegram:setup [--replace] | --find-chat | --test | --info');

    return 1;
  }

  const env = parseConfig(botEnvSchema, source);
  const client =
    deps.client ??
    new BotApiClient({
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      token: env.TELEGRAM_BOT_TOKEN,
    });
  const bot = await client.getMe();
  deps.print(`Telegram bot ${bot.username === undefined ? bot.id : `@${bot.username}`}`);

  switch (modes[0]) {
    case '--find-chat': {
      const info = await client.getWebhookInfo();

      if (info.url !== '') {
        deps.print(
          'A webhook already owns these updates. Use --info; do not disable it to find the chat.',
        );

        return 1;
      }

      const updates = await client.getUpdates();
      const chats = new Map(
        updates.flatMap(({ chat }) => (chat?.type === 'private' ? [[chat.id, chat] as const] : [])),
      );

      if (chats.size !== 1) {
        deps.print(
          'Send /start in your private chat first. If several private chats are pending, set TELEGRAM_CHAT_ID to your own ID manually.',
        );

        return 1;
      }

      const [chatId] = chats.keys();
      await deps.saveChat(String(chatId));
      deps.print('Saved TELEGRAM_CHAT_ID. Run telegram:setup --test next.');

      return 0;
    }

    case '--info': {
      const info = await client.getWebhookInfo();
      deps.print(info.url === '' ? 'No webhook is set.' : `Webhook: ${location(info.url)}`);
      deps.print(`Pending: ${info.pendingUpdateCount}`);

      if (info.lastErrorAt !== undefined) {
        deps.print(`Last delivery error: ${info.lastErrorAt.toISOString()}`);
      }

      return 0;
    }

    case '--test': {
      const chat = parseConfig(chatEnvSchema, source);
      const integrations = readIntegrations(source);
      const legacy = integrations.find(
        (integration) => integration.id === source.HUB_LEGACY_INTEGRATION_ID,
      );
      await client.sendMessage(chat.TELEGRAM_CHAT_ID, {
        ...(legacy === undefined
          ? {}
          : { buttons: [[{ callbackData: `${legacy.id}:s:`, text: 'Status' }]] }),
        html: 'Artsem Automation Hub: Telegram delivery works.',
      });
      deps.print('Test message sent. Check Telegram.');

      return 0;
    }

    default: {
      const setup = parseConfig(setupEnvSchema, source);
      readIntegrations(source);
      const url = new URL('/api/webhook', setup.APP_BASE_URL).href;
      const before = await client.getWebhookInfo();

      if (before.url !== '' && before.url !== url && !flags.has('--replace')) {
        deps.print(
          `Another webhook owns this bot: ${location(before.url)}. Use --replace only after reviewing ownership.`,
        );

        return 1;
      }

      await client.setWebhook({ secretToken: setup.TELEGRAM_WEBHOOK_SECRET, url });
      const after = await client.getWebhookInfo();

      if (after.url !== url) {
        deps.print('Telegram did not confirm the configured hub webhook.');

        return 1;
      }

      deps.print(`Webhook set: ${url}. Pending updates were preserved.`);

      return 0;
    }
  }
}
