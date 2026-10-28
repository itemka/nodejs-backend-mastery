import { describe, expect, it } from 'vitest';

import { parseUpdate } from '../../src/telegram/updates.js';

describe('normalized integration updates', () => {
  it('accepts only the hub protocol for messages and callback data', () => {
    expect(parseUpdate({ input: { kind: 'message', text: '/status' }, updateId: 1 })).toEqual({
      input: { kind: 'message', text: '/status' },
      outcome: 'accepted',
      updateId: 1,
    });
    expect(
      parseUpdate({
        input: { callbackId: 'cb', data: 's:2026-10', kind: 'callback', messageId: 10 },
        updateId: 2,
      }),
    ).toMatchObject({ outcome: 'accepted', updateId: 2 });
  });

  it('refuses raw Telegram updates, extra fields and invalid action input', () => {
    for (const body of [
      null,
      'x',
      { message: { text: '/status' }, update_id: 1 },
      { chatId: 10, input: { kind: 'message', text: '/status' }, updateId: 1 },
      { input: { callbackId: 'x', data: 'x'.repeat(65), kind: 'callback' }, updateId: 1 },
    ]) {
      expect(parseUpdate(body)).toEqual({ outcome: 'invalid' });
    }
  });
});
