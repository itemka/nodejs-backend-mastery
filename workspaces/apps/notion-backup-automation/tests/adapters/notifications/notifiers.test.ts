import { describe, expect, it } from 'vitest';

import { CompositeNotifier } from '../../../src/adapters/notifications/composite-notifier.js';
import { ConsoleNotifier } from '../../../src/adapters/notifications/console-notifier.js';
import { TelegramNotifier } from '../../../src/adapters/notifications/telegram-notifier.js';
import {
  TelegramApiError,
  TelegramClient,
} from '../../../src/adapters/telegram/telegram-client.js';
import type {
  AttentionNotification,
  Notifier,
  SuccessNotification,
} from '../../../src/application/ports.js';
import { createLogger } from '../../../src/shared/logger.js';
import { SecretValue } from '../../../src/shared/secret-value.js';
import {
  FAKE_HUB_URL,
  fakeHubToken,
  FakeTelegram,
  hangingReply,
  telegramError,
} from '../../support/fake-telegram.js';

const success: SuccessNotification = {
  driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
  durationMs: 1_390_000,
  entryCount: 198,
  fileName: 'notion-workspace-2026-10-01.zip',
  folder: '2026',
  jobId: '2026-10',
  period: '2026-10',
  sizeBytes: 412_300_000,
};

const attention: AttentionNotification = {
  code: 'NOTION_SESSION_EXPIRED',
  howToFix: 'Run auth:notion, then run backup_retry.',
  jobId: '2026-10',
  period: '2026-10',
  reason: 'The saved Notion session is no longer signed in.',
  recentEvents: [],
  retryFromScratch: true,
  stage: 'NOTION_TRIGGER',
};

function recordingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (_level, line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });

  return { lines, logger };
}

function telegramNotifier(telegram: FakeTelegram, timeoutMs?: number): TelegramNotifier {
  return new TelegramNotifier({
    appEnv: 'prod',
    client: new TelegramClient({
      fetch: telegram.fetch,
      hubUrl: FAKE_HUB_URL,
      integrationId: 'nb-prod',
      token: new SecretValue(fakeHubToken),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    timeZone: 'Europe/Warsaw',
  });
}

describe('ConsoleNotifier', () => {
  it('writes one structured line per notification, with the summary as text', async () => {
    const { lines, logger } = recordingLogger();
    const notifier = new ConsoleNotifier(logger);

    await notifier.success(success);
    await notifier.attention(attention);
    await notifier.failure({
      code: 'JOB_LIFETIME_EXCEEDED',
      jobId: '2026-10',
      period: '2026-10',
      reason: 'The job exceeded its maximum lifetime.',
      stage: 'EMAIL_WAIT',
    });
    await notifier.loginWarning({ howToFix: 'Run auth:notion.', kind: 'lost', service: 'notion' });
    await notifier.lateEmail({
      exportAttempt: 1,
      jobId: '2026-10',
      period: '2026-10',
      waitedMs: 50 * 60 * 1000,
    });

    expect(lines.map(({ event, level }) => `${String(level)} ${String(event)}`)).toEqual([
      'info notify.success',
      'warn notify.attention',
      'error notify.failure',
      'warn notify.login',
      'warn notify.late_email',
    ]);
    expect(lines[4]).toMatchObject({
      jobId: '2026-10',
      text: '⏳ Notion export email is late · job 2026-10 · attempt 1 · no email after 50 m 0 s',
    });
    expect(lines[0]).toMatchObject({
      jobId: '2026-10',
      period: '2026-10',
      text: '✅ Notion backup completed · job 2026-10 · 198 files (412.3 MB) · notion-workspace-2026-10-01.zip in 2026 · 23 m 10 s',
    });
    expect(lines[1]).toMatchObject({
      code: 'NOTION_SESSION_EXPIRED',
      text: '⚠️ Notion backup requires attention · job 2026-10 · stage NOTION_TRIGGER · NOTION_SESSION_EXPIRED: Run auth:notion, then run backup_retry.',
    });
    expect(lines[3]).toMatchObject({
      kind: 'lost',
      service: 'notion',
      text: '🔑 Notion access is gone · Run auth:notion.',
    });
  });
});

describe('TelegramNotifier', () => {
  it('sends each notification to the configured chat', async () => {
    const telegram = new FakeTelegram();

    await telegramNotifier(telegram).success(success);

    expect(telegram.sentMessages()).toEqual([
      expect.objectContaining({ html: expect.any(String) }),
    ]);
    expect(String(telegram.sentMessages()[0]?.html)).toContain('✅ <b>Notion backup stored</b>');
  });

  it('rejects when Telegram does, so the composite can log it', async () => {
    const telegram = new FakeTelegram().on('sendMessage', () => telegramError(500, 'Internal'));

    await expect(telegramNotifier(telegram).attention(attention)).rejects.toBeInstanceOf(
      TelegramApiError,
    );
  });
});

describe('CompositeNotifier', () => {
  it('delivers to every notifier, and logs a failing one by name and code only', async () => {
    const { lines, logger } = recordingLogger();
    const telegram = new FakeTelegram().on('sendMessage', () =>
      telegramError(500, 'Internal Server Error: secret detail'),
    );
    const delivered: string[] = [];
    const recording: Notifier = {
      attention: () => Promise.resolve(),
      failure: () => Promise.resolve(),
      lateEmail: () => Promise.resolve(),
      loginWarning: () => Promise.resolve(),
      success: (notification) => {
        delivered.push(notification.jobId);

        return Promise.resolve();
      },
    };
    const composite = new CompositeNotifier(
      [
        { name: 'telegram', notifier: telegramNotifier(telegram) },
        { name: 'recording', notifier: recording },
      ],
      logger,
    );

    await expect(composite.success(success)).resolves.toBeUndefined();

    expect(delivered).toEqual(['2026-10']);
    expect(lines).toEqual([
      expect.objectContaining({
        code: 'hub_500',
        event: 'notify.failed',
        kind: 'success',
        notifier: 'telegram',
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain('secret detail');
  });

  it('never fails the caller, not even for a Telegram that times out or a notifier that throws', async () => {
    const { lines, logger } = recordingLogger();
    const throwing: Notifier = {
      attention: () => {
        throw new Error('synchronous bug');
      },
      failure: () => Promise.resolve(),
      lateEmail: () => Promise.resolve(),
      loginWarning: () => Promise.resolve(),
      success: () => Promise.resolve(),
    };
    const composite = new CompositeNotifier(
      [
        {
          name: 'telegram',
          notifier: telegramNotifier(new FakeTelegram().on('sendMessage', hangingReply), 20),
        },
        { name: 'broken', notifier: throwing },
      ],
      logger,
    );

    await expect(composite.attention(attention)).resolves.toBeUndefined();

    expect(lines.map(({ code, notifier }) => `${String(notifier)} ${String(code)}`)).toEqual([
      'broken Error',
      'telegram timeout',
    ]);
  });
});
