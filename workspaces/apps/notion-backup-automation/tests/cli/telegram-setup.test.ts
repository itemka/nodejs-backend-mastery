import { describe, expect, it } from 'vitest';

import { main } from '../../src/cli/main.js';
import { testCli } from '../support/cli-context.js';
import { FAKE_HUB_URL, fakeHubToken, FakeTelegram } from '../support/fake-telegram.js';

describe('backup Telegram compatibility command', () => {
  it('sends a test notification through the hub with an environment-scoped Status button', async () => {
    const hub = new FakeTelegram();
    const cli = await testCli({
      env: { APP_ENV: 'dev', TELEGRAM_HUB_TOKEN: fakeHubToken, TELEGRAM_HUB_URL: FAKE_HUB_URL },
      fetch: hub.fetch,
    });
    await expect(main(['telegram:setup', '--test'], cli.context)).resolves.toBe(0);
    expect(hub.sentMessages()[0]).toMatchObject({
      buttons: [[{ callbackData: 'nb-dev:s:', text: 'Status' }]],
    });
    expect(cli.text()).toContain('through telegram-webhook-hub');
    expect(cli.text()).not.toContain(fakeHubToken);
  });

  it.each([{ args: [] }, { args: ['--replace'] }, { args: ['--find-chat'] }, { args: ['--info'] }])(
    'redirects hub-owned mode %j without any HTTP requests',
    async ({ args }) => {
      const hub = new FakeTelegram();
      const cli = await testCli({ fetch: hub.fetch });
      await expect(main(['telegram:setup', ...args], cli.context)).resolves.toBe(1);
      expect(cli.text()).toContain('pnpm --filter telegram-webhook-hub cli telegram:setup');
      expect(hub.calls).toEqual([]);
    },
  );

  it('reports missing hub configuration for a backup test', async () => {
    const cli = await testCli();
    await expect(main(['telegram:setup', '--test'], cli.context)).resolves.toBe(1);
    expect(cli.text()).toContain('TELEGRAM_HUB_TOKEN');
  });
});
