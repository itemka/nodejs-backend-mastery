import { readFile, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { main } from '../../src/cli/main.js';
import { testCli } from '../support/cli-context.js';
import {
  FAKE_CHAT_ID,
  fakeBotToken,
  FakeTelegram,
  telegramError,
  telegramOk,
} from '../support/fake-telegram.js';

const botEnv = { TELEGRAM_BOT_TOKEN: fakeBotToken };
const chatEnv = { ...botEnv, APP_ENV: 'dev', TELEGRAM_CHAT_ID: FAKE_CHAT_ID };

function privateMessage(updateId: number, chat: Record<string, unknown>) {
  return {
    message: { chat: { type: 'private', ...chat }, date: 0, message_id: updateId, text: '/start' },
    update_id: updateId,
  };
}

async function setup(telegram: FakeTelegram, env: Record<string, string> = botEnv) {
  return testCli({ env, fetch: telegram.fetch });
}

describe('telegram:setup --find-chat', () => {
  it('saves the one private chat as TELEGRAM_CHAT_ID in .env.local, mode 0600', async () => {
    const telegram = new FakeTelegram().on('getUpdates', () =>
      telegramOk([privateMessage(1, { first_name: 'Artsem', id: 424_242, username: 'artsem' })]),
    );
    const cli = await setup(telegram);

    await writeFile(cli.context.envFilePath, 'APP_ENV=dev\n');

    await expect(main(['telegram:setup', '--find-chat'], cli.context)).resolves.toBe(0);

    expect(await readFile(cli.context.envFilePath, 'utf8')).toBe(
      'APP_ENV=dev\nTELEGRAM_CHAT_ID=424242\n',
    );
    const { mode } = await stat(cli.context.envFilePath);

    expect(mode & 0o777).toBe(0o600);
    expect(cli.text()).toContain('Telegram chat with @test_backup_bot');
    expect(cli.text()).toContain('chat 424242  @artsem');
    expect(cli.text()).not.toContain(fakeBotToken);
  });

  it('asks for /start when no private message is waiting, and ignores group chats', async () => {
    const telegram = new FakeTelegram().on('getUpdates', () =>
      telegramOk([privateMessage(1, { id: -100_123, title: 'Group', type: 'group' })]),
    );
    const cli = await setup(telegram);

    await expect(main(['telegram:setup', '--find-chat'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('Send /start to the bot in Telegram');
  });

  it('saves nothing when two private chats wrote to the bot', async () => {
    const telegram = new FakeTelegram().on('getUpdates', () =>
      telegramOk([
        privateMessage(1, { first_name: 'Artsem', id: 424_242 }),
        privateMessage(2, { first_name: 'Someone', id: 515_151 }),
      ]),
    );
    const cli = await setup(telegram);

    await expect(main(['telegram:setup', '--find-chat'], cli.context)).resolves.toBe(1);

    await expect(stat(cli.context.envFilePath)).rejects.toThrow();
    expect(cli.text()).toContain('chat 515151  Someone');
    expect(cli.text()).toContain('Set TELEGRAM_CHAT_ID to yours');
  });

  it('points to --info when a webhook holds the updates', async () => {
    const telegram = new FakeTelegram().on('getUpdates', () =>
      telegramError(409, 'Conflict: can’t use getUpdates method while webhook is active'),
    );
    const cli = await setup(telegram);

    await expect(main(['telegram:setup', '--find-chat'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('Run telegram:setup --info');
  });
});

describe('telegram:setup --test', () => {
  it('sends the test message with a Status button to TELEGRAM_CHAT_ID', async () => {
    const telegram = new FakeTelegram();
    const cli = await setup(telegram, chatEnv);

    await expect(main(['telegram:setup', '--test'], cli.context)).resolves.toBe(0);

    expect(telegram.sentMessages()).toEqual([
      expect.objectContaining({
        chat_id: FAKE_CHAT_ID,
        reply_markup: { inline_keyboard: [[{ callback_data: 's:', text: 'Status' }]] },
      }),
    ]);
    expect(cli.text()).toContain(`to chat ${FAKE_CHAT_ID}`);
  });

  it('names the failure, never the token', async () => {
    const telegram = new FakeTelegram().on('sendMessage', () =>
      telegramError(403, 'Forbidden: bot was blocked by the user'),
    );
    const cli = await setup(telegram, chatEnv);

    await expect(main(['telegram:setup', '--test'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain(
      'telegram_403: Telegram sendMessage failed: 403 Forbidden: bot was blocked by the user',
    );
    expect(cli.text()).not.toContain(fakeBotToken);
  });

  it('needs the chat ID', async () => {
    const cli = await setup(new FakeTelegram(), { ...botEnv, APP_ENV: 'dev' });

    await expect(main(['telegram:setup', '--test'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('missing TELEGRAM_CHAT_ID');
  });
});

describe('telegram:setup --info', () => {
  it('says when no webhook is set', async () => {
    const cli = await setup(new FakeTelegram());

    await expect(main(['telegram:setup', '--info'], cli.context)).resolves.toBe(0);
    expect(cli.text()).toContain('No webhook is set');
    expect(cli.text()).toContain('pending       0 updates');
  });

  it('shows the webhook’s host and path only, hiding a token-shaped segment and the query', async () => {
    const telegram = new FakeTelegram().on('getWebhookInfo', () =>
      telegramOk({
        last_error_date: 1_790_000_000,
        last_error_message: 'Wrong response from the webhook: 500 Internal Server Error',
        pending_update_count: 2,
        url: 'https://other-app.example.com/hooks/AbCdEfGhIjKlMnOpQrStUvWxYz012345?secret=abc',
      }),
    );
    const cli = await setup(telegram);

    await expect(main(['telegram:setup', '--info'], cli.context)).resolves.toBe(0);

    expect(cli.text()).toContain('webhook       https://other-app.example.com/hooks/[redacted]');
    expect(cli.text()).toContain('pending       2 updates');
    expect(cli.text()).toContain(
      'last error    2026-09-21T14:13:20.000Z Wrong response from the webhook: 500 Internal Server Error',
    );
    expect(cli.text()).not.toContain('secret=abc');
    expect(cli.text()).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(telegram.calls.map(({ method }) => method)).toEqual(['getMe', 'getWebhookInfo']);
  });
});

describe('telegram:setup arguments', () => {
  it.each([[[]], [['--find-chat', '--test']]])('needs exactly one mode: %j', async (flags) => {
    const cli = await setup(new FakeTelegram());

    await expect(main(['telegram:setup', ...flags], cli.context)).resolves.toBe(2);
    expect(cli.text()).toContain('telegram:setup takes one of --find-chat, --test or --info');
  });
});
