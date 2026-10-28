import { describe, expect, it, vi } from 'vitest';

import { keyPrefixFor } from '../../src/adapters/persistence/keys.js';
import { RedisTelegramState } from '../../src/adapters/persistence/redis-telegram-state.js';
import { SchedulerError } from '../../src/adapters/qstash/qstash-scheduler.js';
import { TelegramClient } from '../../src/adapters/telegram/telegram-client.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import { SecretValue } from '../../src/shared/secret-value.js';
import { TELEGRAM_CANCEL_REASON, TelegramWebhook } from '../../src/telegram/webhook.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';
import { FakeRedis } from '../support/fake-redis.js';
import {
  FAKE_HUB_URL,
  fakeHubToken,
  FakeTelegram,
  telegramError,
} from '../support/fake-telegram.js';

const REPORT_MESSAGE_ID = 10;

function webhookHarness() {
  const harness = backupHarness();
  const telegram = new FakeTelegram();
  const redis = new FakeRedis();
  const keyPrefix = keyPrefixFor('test');
  const webhook = new TelegramWebhook({
    client: new TelegramClient({
      fetch: telegram.fetch,
      hubUrl: FAKE_HUB_URL,
      integrationId: 'nb-prod',
      token: new SecretValue(fakeHubToken),
    }),
    format: { appEnv: 'prod', timeZone: 'Europe/Warsaw' },
    ids: harness.ids,
    logger: harness.logger,
    policy: harness.policy,
    service: harness.service,
    state: new RedisTelegramState(redis, keyPrefix, harness.clock),
  });
  let nextUpdateId = 1;

  return {
    ...harness,
    /** The hub has authenticated and normalized every forwarded update. */
    message: (text: string) =>
      webhook.handle({ input: { kind: 'message', text }, updateId: nextUpdateId++ }),
    redis,
    tap: (data: string, messageId = REPORT_MESSAGE_ID) =>
      webhook.handle({
        input: { callbackId: `cb-${nextUpdateId}`, data, kind: 'callback', messageId },
        updateId: nextUpdateId++,
      }),
    telegram,
    webhook,
  };
}

type WebhookHarness = ReturnType<typeof webhookHarness>;

/** The text of every message the bot sent, in order. */
function replies(harness: WebhookHarness): string[] {
  return harness.telegram.sentMessages().map((body) => String(body.html));
}

/** The notices on tapped buttons, in order; undefined for a plain answer. */
function answers(harness: WebhookHarness): (string | undefined)[] {
  return harness.telegram
    .bodiesOf('answerCallbackQuery')
    .map((body) => body.text as string | undefined);
}

/** The `callback_data` of every button on the last message sent. */
function lastButtons(harness: WebhookHarness): string[] {
  const buttons = harness.telegram.sentMessages().at(-1)?.buttons as
    | { callbackData?: string; url?: string }[][]
    | undefined;

  // The routing prefix is removed by the hub before a callback reaches this adapter.
  return (buttons ?? [])
    .flat()
    .map((button) => button.callbackData?.replace(/^nb-prod:/, '') ?? button.url ?? '');
}

/** A job that waits for the Notion login. */
async function waitingForLogin(harness: WebhookHarness): Promise<void> {
  harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
  await harness.service.start();
  await harness.drain();
}

describe('the Telegram webhook', () => {
  it('answers /status with the active or latest job, and its buttons', async () => {
    const harness = webhookHarness();

    await expect(harness.message('/status')).resolves.toBe('handled');
    expect(replies(harness)).toEqual(['No backup job exists yet.']);

    await harness.service.start();
    await harness.message('/status@test_backup_bot');

    expect(replies(harness)[1]).toContain('<b>Job 2026-10</b> · CREATED · stage NOTION_TRIGGER');
    expect(lastButtons(harness)).toEqual(['s:2026-10', 'x:2026-10']);

    await harness.drain();
    await harness.message('/status');

    expect(replies(harness)[2]).toContain('✅ <b>Job 2026-10</b> · COMPLETE');
    expect(lastButtons(harness)).toEqual([
      expect.stringMatching(/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/),
    ]);
  });

  it('answers any other message with the help text, and never starts a backup', async () => {
    const harness = webhookHarness();

    await harness.message('start a backup please');

    expect(replies(harness)).toEqual([expect.stringContaining('/status shows the active')]);
    expect(harness.qstash.published).toEqual([]);
  });

  it('deduplicates a completed normalized update, including a lost HTTP response replay', async () => {
    const harness = webhookHarness();
    const update = { input: { kind: 'message', text: '/status' }, updateId: 900 };

    await expect(harness.webhook.handle(update)).resolves.toBe('handled');
    await expect(harness.webhook.handle(update)).resolves.toBe('duplicate');
    expect(replies(harness)).toHaveLength(1);
    expect(harness.redis.strings.get('{nba:test}:telegram:update:900')).toBe('done');
    expect(harness.redis.expirySeconds.get('{nba:test}:telegram:update:900')).toBe(172_800);
  });

  it('ignores anything that is not an update', async () => {
    const harness = webhookHarness();

    await expect(harness.webhook.handle({ hello: 'world' })).resolves.toBe('invalid');
    await expect(harness.webhook.handle('not an update')).resolves.toBe('invalid');
    expect(harness.telegram.calls).toEqual([]);
  });

  it('Status shows the tapped job and answers the button', async () => {
    const harness = webhookHarness();

    await waitingForLogin(harness);
    await harness.tap('s:2026-10');

    expect(replies(harness)[0]).toContain('⚠️ <b>Job 2026-10</b> · NEEDS_ATTENTION');
    expect(replies(harness)[0]).toContain('<b>NOTION_SESSION_EXPIRED</b> (stage NOTION_TRIGGER)');
    expect(lastButtons(harness)).toEqual([
      's:2026-10',
      'r:2026-10',
      'f:2026-10',
      'x:2026-10',
      'l:notion',
    ]);
    expect(answers(harness)).toEqual([undefined]);
  });

  it('Retry resumes the job, then removes the report’s buttons', async () => {
    const harness = webhookHarness();

    await waitingForLogin(harness);
    await harness.tap('r:2026-10');

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'TRIGGERING_EXPORT',
    });
    expect(harness.qstash.published.at(-1)).toMatchObject({ delaySec: 0, reason: 'retry' });
    expect(replies(harness)).toEqual([
      expect.stringContaining('Job 2026-10 retried: TRIGGERING_EXPORT'),
    ]);
    expect(harness.telegram.bodiesOf('removeButtons')).toEqual([
      {
        messageId: REPORT_MESSAGE_ID,
      },
    ]);
    expect(answers(harness)).toEqual(['Retry queued']);
  });

  it('a stale button changes nothing: the job moved on', async () => {
    const harness = webhookHarness();

    await harness.service.start();
    await harness.drain();

    const published = harness.qstash.published.length;

    for (const data of ['r:2026-10', 'f:2026-10', 'x:2026-10']) {
      await harness.tap(data);
    }

    expect(answers(harness)).toEqual([
      'Job 2026-10 is already COMPLETE',
      'Job 2026-10 is already COMPLETE',
      'Job 2026-10 is already COMPLETE',
    ]);
    expect(harness.qstash.published).toHaveLength(published);
    expect(replies(harness)).toEqual([]);
    expect(harness.telegram.bodiesOf('removeButtons')).toEqual([]);
  });

  it('Cancel needs a second tap, which works once', async () => {
    const harness = webhookHarness();

    await harness.service.start();
    await harness.tap('x:2026-10');

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'CREATED' });
    expect(replies(harness)).toEqual([
      expect.stringContaining('Tap again to confirm: cancel job 2026-10.'),
    ]);

    const [confirm] = lastButtons(harness);

    expect(confirm).toMatch(/^c:token-\d{10}$/);
    expect(
      harness.redis.expirySeconds.get(`{nba:test}:telegram:confirm:${confirm?.slice(2)}`),
    ).toBe(600);

    await harness.tap(confirm ?? '', 11);

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(harness.memory.listEvents('2026-10', { limit: 20 })).resolves.toContainEqual(
      expect.objectContaining({ text: `cancel.requested · ${TELEGRAM_CANCEL_REASON}` }),
    );
    expect(replies(harness)[1]).toBe('🚫 Job 2026-10 cancelled.');
    expect(harness.telegram.bodiesOf('removeButtons').map((body) => body.messageId)).toEqual([
      11,
      REPORT_MESSAGE_ID,
    ]);

    await harness.tap(confirm ?? '', 11);

    expect(answers(harness).at(-1)).toBe(
      'This confirmation expired or was used; tap the button on the report again',
    );
    expect(replies(harness)).toHaveLength(2);
  });

  it('Retry from scratch needs a second tap, then opens a new export attempt', async () => {
    const harness = webhookHarness();

    harness.transfer.script = [
      { at: 'UPLOADING', error: new IntegrationError('DRIVE_ROOT_INACCESSIBLE') },
    ];
    await harness.service.start();
    await harness.drain();

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      exportAttempt: 1,
      status: 'NEEDS_ATTENTION',
    });

    await harness.tap('f:2026-10');

    expect(replies(harness)).toEqual([
      expect.stringContaining('retry job 2026-10 from scratch, with a new Notion export'),
    ]);
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'NEEDS_ATTENTION',
    });

    const [confirm] = lastButtons(harness);

    await harness.tap(confirm ?? '', 11);

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      exportAttempt: 2,
      status: 'TRIGGERING_EXPORT',
    });
    expect(replies(harness)[1]).toContain('Job 2026-10 retried from scratch: TRIGGERING_EXPORT');
    expect(answers(harness)).toEqual([undefined, 'Retry queued']);
  });

  it('Retry from scratch is refused once every export attempt is used, and hidden', async () => {
    const harness = webhookHarness();

    harness.emails.arriveFor = () => 'never';
    await harness.service.start();
    await harness.drain();
    await harness.tap('f:2026-10');

    expect(answers(harness)).toEqual(['Job 2026-10 used all 3 export attempts']);
    expect(replies(harness)).toEqual([]);

    await harness.tap('s:2026-10');

    expect(lastButtons(harness)).toEqual(['s:2026-10', 'r:2026-10', 'x:2026-10']);
  });

  it('Fix login replies with the command for each login', async () => {
    const harness = webhookHarness();

    await harness.tap('l:notion');
    await harness.tap('l:google');
    await harness.tap('l:drive');
    await harness.tap('l:gmail');

    const [notion, google, drive] = replies(harness);

    expect(notion).toContain(
      '<code>APP_ENV=prod pnpm --filter notion-backup-automation auth:notion</code>',
    );
    expect(google).toContain('update GOOGLE_REFRESH_TOKEN in Vercel and redeploy');
    expect(google).toContain('<code>pnpm --filter notion-backup-automation auth:google</code>');
    expect(drive).toContain('<code>pnpm --filter notion-backup-automation drive:check</code>');
    expect(replies(harness)).toHaveLength(3);
    expect(answers(harness)).toEqual([undefined, undefined, undefined, 'Unknown button']);
  });

  it('replies to a refusal with its code and message, and answers every tap', async () => {
    const harness = webhookHarness();

    await harness.tap('r:2026-11');
    await harness.tap('zzz');

    expect(replies(harness)).toEqual(['JOB_NOT_FOUND: No job 2026-11']);
    expect(answers(harness)).toEqual([undefined, 'Unknown button']);
  });

  it('keeps a scheduler failure retryable, without its details, and leaves the tap unanswered', async () => {
    const harness = webhookHarness();

    harness.telegram.on('removeButtons', () => telegramError(400, 'message is not modified'));
    await waitingForLogin(harness);
    vi.spyOn(harness.qstash, 'schedule').mockRejectedValueOnce(new SchedulerError('publish'));
    await expect(harness.tap('r:2026-10')).rejects.toThrow();

    expect(replies(harness)).toEqual([]);
    expect(answers(harness)).toEqual([]);
    expect(harness.logs).toContainEqual(expect.objectContaining({ event: 'telegram.failed' }));
  });

  it('answers a tap once, with its real notice, when the resent update succeeds', async () => {
    const harness = webhookHarness();
    const update = {
      input: { callbackId: 'cb-905', data: 'r:2026-10', kind: 'callback', messageId: 10 },
      updateId: 905,
    };

    await waitingForLogin(harness);
    vi.spyOn(harness.service, 'status').mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(harness.webhook.handle(update)).rejects.toThrow('Redis unavailable');
    expect(answers(harness)).toEqual([]);

    await expect(harness.webhook.handle(update)).resolves.toBe('handled');
    expect(answers(harness)).toEqual(['Retry queued']);
  });

  it.each([400, 403, 422])(
    'finishes an update whose reply the hub refuses for good (HTTP %i)',
    async (status) => {
      const harness = webhookHarness();
      const update = {
        input: { callbackId: 'cb-906', data: 's:', kind: 'callback', messageId: 10 },
        updateId: 906,
      };

      harness.telegram.on('sendMessage', () => telegramError(status, 'TELEGRAM_REJECTED'));
      await expect(harness.webhook.handle(update)).resolves.toBe('rejected');
      expect(harness.redis.strings.get('{nba:test}:telegram:update:906')).toBe('done');
      expect(answers(harness)).toEqual([undefined]);
      expect(harness.logs).toContainEqual(
        expect.objectContaining({ code: `hub_${status}`, event: 'telegram.rejected' }),
      );
      expect(harness.logs).not.toContainEqual(
        expect.objectContaining({ event: 'telegram.failed' }),
      );

      await expect(harness.webhook.handle(update)).resolves.toBe('duplicate');
      expect(harness.telegram.sentMessages()).toHaveLength(1);
    },
  );

  it('finishes a message whose refusal notice the hub also refuses', async () => {
    const harness = webhookHarness();

    harness.telegram.on('sendMessage', () => telegramError(422, 'TELEGRAM_REJECTED'));
    await expect(harness.tap('r:2026-11')).resolves.toBe('rejected');
    await expect(harness.message('/status')).resolves.toBe('rejected');
    expect(harness.redis.strings.get('{nba:test}:telegram:update:2')).toBe('done');
  });

  it.each([408, 429])('keeps a hub HTTP %i retryable', async (status) => {
    const harness = webhookHarness();

    harness.telegram.on('sendMessage', () => telegramError(status, 'Busy'));
    await expect(harness.message('/status')).rejects.toMatchObject({ code: `hub_${status}` });
    expect(harness.redis.strings.has('{nba:test}:telegram:update:1')).toBe(false);
  });

  it('releases an update when the hub is temporarily unavailable so the same update can retry', async () => {
    const harness = webhookHarness();
    const update = { input: { kind: 'message', text: '/status' }, updateId: 901 };

    harness.telegram.on('sendMessage', () => telegramError(503, 'Unavailable'));
    await expect(harness.webhook.handle(update)).rejects.toMatchObject({ code: 'hub_503' });
    expect(harness.redis.strings.has('{nba:test}:telegram:update:901')).toBe(false);

    harness.telegram.on('sendMessage', () => Response.json({ messageId: 99 }));
    await expect(harness.webhook.handle(update)).resolves.toBe('handled');
    expect(harness.redis.strings.get('{nba:test}:telegram:update:901')).toBe('done');
  });

  it('replays a committed action receipt after delivery fails, even if the worker opens another incident', async () => {
    const harness = webhookHarness();

    await waitingForLogin(harness);
    const retry = vi.spyOn(harness.service, 'retry');
    const update = {
      input: { callbackId: 'cb-902', data: 'r:2026-10', kind: 'callback', messageId: 10 },
      updateId: 902,
    };

    harness.telegram.on('sendMessage', () => telegramError(503, 'Unavailable'));
    await expect(harness.webhook.handle(update)).rejects.toMatchObject({ code: 'hub_503' });
    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.drain();
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'NEEDS_ATTENTION',
    });

    harness.telegram.on('sendMessage', () => Response.json({ messageId: 99 }));
    await expect(harness.webhook.handle(update)).resolves.toBe('handled');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(harness.qstash.published.filter((wake) => wake.reason === 'retry')).toHaveLength(1);
    expect(replies(harness).at(-1)).toContain('retried: TRIGGERING_EXPORT');
  });

  it('binds the original action intent before mutation so a receipt-write failure cannot retry a later incident', async () => {
    const harness = webhookHarness();

    await waitingForLogin(harness);
    const retry = vi.spyOn(harness.service, 'retry');
    const originalSet = harness.redis.set.bind(harness.redis);
    const set = vi.spyOn(harness.redis, 'set').mockImplementation((key, value, options) => {
      if (key.includes(':telegram:action:')) {
        return Promise.reject(new Error('Redis unavailable'));
      }

      return originalSet(key, value, options);
    });
    const update = {
      input: { callbackId: 'cb-903', data: 'r:2026-10', kind: 'callback', messageId: 10 },
      updateId: 903,
    };

    await expect(harness.webhook.handle(update)).rejects.toThrow('Redis unavailable');
    set.mockRestore();
    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.drain();
    await expect(harness.webhook.handle(update)).resolves.toBe('handled');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(answers(harness).at(-1)).toBe(
      'This action already ran or the job changed; use a fresh button',
    );
  });

  it('keeps a confirmed action pending after a transient status read failure', async () => {
    const harness = webhookHarness();

    await harness.service.start();
    await harness.tap('x:2026-10');
    const [confirm] = lastButtons(harness);
    const status = vi
      .spyOn(harness.service, 'status')
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    const update = {
      input: { callbackId: 'cb-904', data: confirm ?? '', kind: 'callback', messageId: 11 },
      updateId: 904,
    };

    await expect(harness.webhook.handle(update)).rejects.toThrow('Redis unavailable');
    expect(harness.redis.strings.has(`{nba:test}:telegram:confirm:${confirm?.slice(2)}`)).toBe(
      true,
    );
    status.mockRestore();
    await expect(harness.webhook.handle(update)).resolves.toBe('handled');
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('sends no URL but the Drive file link, and no token-shaped text', async () => {
    const harness = webhookHarness();

    await harness.service.start();
    await harness.memory.appendEvent('2026-10', {
      at: '2026-10-01T04:01:00.000Z',
      text: `note https://file.notion.com/f/x?signature=abc Bearer ${'a'.repeat(30)}`,
      type: 'note',
    });
    await harness.message('/status');
    await harness.drain();
    await harness.message('/status');

    const sent = JSON.stringify(harness.telegram.sentMessages());

    expect(sent).not.toMatch(/file\.notion\.com|signature=|Bearer a/);
    expect(
      sent
        .match(/https?:\/\/[^"\s]+/g)
        ?.every((url) => url.startsWith('https://drive.google.com/file/d/')),
    ).toBe(true);
  });
});
