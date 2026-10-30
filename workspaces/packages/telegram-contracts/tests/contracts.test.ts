import {
  callbackDataSchema,
  hubOperationSchema,
  integrationUpdateSchema,
  isPermanentRefusal,
  telegramMessageSchema,
} from '@workspaces/telegram-contracts';
import { describe, expect, it } from 'vitest';

const message = (button: unknown) => ({ buttons: [[button]], html: 'report' });

describe('Telegram HTTP boundaries', () => {
  it('counts callback bytes, including namespace and multibyte characters', () => {
    expect(callbackDataSchema.safeParse('nb-prod:s:2026-10').success).toBe(true);
    expect(callbackDataSchema.safeParse('é'.repeat(32)).success).toBe(true);
    expect(callbackDataSchema.safeParse('é'.repeat(33)).success).toBe(false);
    expect(callbackDataSchema.safeParse('nb-prod:' + 'a'.repeat(57)).success).toBe(false);
  });

  it('rejects caller-selected destinations and arbitrary Telegram methods', () => {
    expect(
      hubOperationSchema.safeParse({
        action: 'sendMessage',
        chatId: 'another-chat',
        message: { html: 'hello' },
      }).success,
    ).toBe(false);
    expect(
      hubOperationSchema.safeParse({ action: 'setWebhook', url: 'https://bad.test' }).success,
    ).toBe(false);
    expect(hubOperationSchema.safeParse({ action: 'deleteMessage', messageId: 1 }).success).toBe(
      false,
    );
  });

  it('rejects ambiguous buttons, unsupported schemes and oversize messages', () => {
    expect(
      telegramMessageSchema.safeParse(
        message({ callbackData: 'nb-prod:s:2026-10', text: 'Status', url: 'https://drive.test' }),
      ).success,
    ).toBe(false);
    expect(
      telegramMessageSchema.safeParse(message({ text: 'Open', url: 'javascript:alert(1)' }))
        .success,
    ).toBe(false);
    expect(telegramMessageSchema.safeParse({ html: 'x'.repeat(4097) }).success).toBe(false);
    expect(
      telegramMessageSchema.safeParse(message({ text: 'Open', url: 'https://drive.test/file' }))
        .success,
    ).toBe(true);
  });

  it('accepts normalized messages and callbacks and refuses raw Telegram updates', () => {
    expect(
      integrationUpdateSchema.parse({ input: { kind: 'message', text: '/status' }, updateId: 1 }),
    ).toEqual({ input: { kind: 'message', text: '/status' }, updateId: 1 });
    expect(
      integrationUpdateSchema.safeParse({
        input: { callbackId: 'tap-1', data: 's:2026-10', kind: 'callback', messageId: 42 },
        updateId: 2,
      }).success,
    ).toBe(true);
    expect(
      integrationUpdateSchema.safeParse({ message: { text: '/status' }, update_id: 1 }).success,
    ).toBe(false);
    expect(
      integrationUpdateSchema.safeParse({
        input: { kind: 'message', text: '/status' },
        updateId: -1,
      }).success,
    ).toBe(false);
  });

  it.each([
    [400, true],
    [401, true],
    [422, true],
    [499, true],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
    [200, false],
  ])('treats HTTP %i as a permanent refusal: %s', (status, permanent) => {
    expect(isPermanentRefusal(status)).toBe(permanent);
  });
});
