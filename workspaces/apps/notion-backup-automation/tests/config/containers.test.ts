import { describe, expect, it } from 'vitest';

import type { SuccessNotification } from '../../src/application/ports.js';
import type { NotifierEnv } from '../../src/config/containers.js';
import { createNotifier } from '../../src/config/containers.js';
import { createLogger } from '../../src/shared/logger.js';
import { FAKE_CHAT_ID, fakeBotToken, FakeTelegram } from '../support/fake-telegram.js';

const success: SuccessNotification = {
  driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
  durationMs: 60_000,
  entryCount: 198,
  fileName: 'notion-workspace-2026-10-01.zip',
  folder: '2026',
  jobId: '2026-10',
  period: '2026-10',
  sizeBytes: 8_907_221,
};

const base: NotifierEnv = {
  APP_ENV: 'prod',
  BACKUP_TIME_ZONE: 'Europe/Warsaw',
  NOTIFIERS: ['console'],
};

function notifierFor(env: NotifierEnv) {
  const telegram = new FakeTelegram();
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger({
    sink: (_level, line) => {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });

  return { logs, notifier: createNotifier(env, { fetch: telegram.fetch, logger }), telegram };
}

describe('createNotifier', () => {
  it('notifies through the console only by default', async () => {
    const { logs, notifier, telegram } = notifierFor(base);

    await notifier.success(success);

    expect(logs.map(({ event }) => event)).toEqual(['notify.success']);
    expect(telegram.calls).toEqual([]);
  });

  it('adds Telegram when it is listed and configured', async () => {
    const { logs, notifier, telegram } = notifierFor({
      ...base,
      NOTIFIERS: ['console', 'telegram'],
      TELEGRAM_BOT_TOKEN: fakeBotToken,
      TELEGRAM_CHAT_ID: FAKE_CHAT_ID,
    });

    await notifier.success(success);

    expect(logs.map(({ event }) => event)).toEqual(['notify.success']);
    expect(telegram.sentMessages()).toEqual([expect.objectContaining({ chat_id: FAKE_CHAT_ID })]);
  });

  it('leaves Telegram out, with a warning naming what is missing, when it is not configured', async () => {
    const { logs, notifier, telegram } = notifierFor({
      ...base,
      NOTIFIERS: ['console', 'telegram'],
      TELEGRAM_BOT_TOKEN: fakeBotToken,
    });

    await notifier.success(success);

    expect(logs).toEqual([
      expect.objectContaining({
        event: 'notify.telegram.unconfigured',
        missing: ['TELEGRAM_CHAT_ID'],
      }),
      expect.objectContaining({ event: 'notify.success' }),
    ]);
    expect(telegram.calls).toEqual([]);
  });
});
