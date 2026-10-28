import * as ui from '@workspaces/cli-output';

import { testMessage } from '../../adapters/telegram/message-formats.js';
import { TelegramClient } from '../../adapters/telegram/telegram-client.js';
import { loadEnv, telegramChatEnvSchema, telegramIntegrationId } from '../../config/env.js';
import { SecretValue } from '../../shared/secret-value.js';
import type { CliContext } from '../context.js';
import { fetchOption } from '../context.js';

export type TelegramSetupMode = 'find-chat' | 'info' | 'test' | 'webhook';

/** The hub is the sole webhook owner; this compatibility command can only send a test. */
export async function runTelegramSetup(
  { mode, replace = false }: { mode: TelegramSetupMode; replace?: boolean },
  context: CliContext,
): Promise<number> {
  if (mode !== 'test' || replace) {
    const suffix = mode === 'webhook' ? (replace ? ' --replace' : '') : ` --${mode}`;

    context.print(ui.warn('Telegram bot setup belongs to telegram-webhook-hub.'));
    context.print(`Run: pnpm --filter telegram-webhook-hub cli telegram:setup${suffix}`);

    return 1;
  }

  const env = loadEnv(telegramChatEnvSchema, context.env);
  const client = new TelegramClient({
    hubUrl: env.TELEGRAM_HUB_URL,
    integrationId: telegramIntegrationId(env),
    token: new SecretValue(env.TELEGRAM_HUB_TOKEN),
    ...fetchOption(context),
  });
  const { messageId } = await client.sendMessage(testMessage({ appEnv: env.APP_ENV }));

  context.print(
    ui.ok(`Sent message ${messageId} through telegram-webhook-hub. Check Telegram on your phone.`),
  );

  return 0;
}
