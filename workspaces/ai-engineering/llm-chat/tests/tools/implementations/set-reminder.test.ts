import { describe, expect, it } from 'vitest';

import { setReminderTool } from '../../../src/tools/implementations/set-reminder.js';
import { createReminderStore } from '../../../src/tools/types.js';
import type { AppToolExecutionContext } from '../../../src/tools/types.js';

function createContext(): AppToolExecutionContext {
  return {
    now: () => new Date('2026-05-04T12:00:00.000Z'),
    reminderStore: createReminderStore(),
  };
}

function executeSetReminder(
  input: unknown,
  context: AppToolExecutionContext,
): Record<string, unknown> {
  return setReminderTool.execute(input, context) as Record<string, unknown>;
}

describe('set_reminder', () => {
  it('stores reminders in the injected process-local store', () => {
    const context = createContext();

    const result = executeSetReminder(
      {
        message: 'Dentist appointment',
        scheduled_for: '2026-05-05T09:00:00.000Z',
      },
      context,
    );

    expect(result).toEqual({
      id: 'reminder-1',
      message: 'Dentist appointment',
      scheduled_for: '2026-05-05T09:00:00.000Z',
      storage: 'process-local',
      total_reminders: 1,
    });
    expect(context.reminderStore.reminders).toEqual([
      {
        id: 'reminder-1',
        message: 'Dentist appointment',
        scheduledFor: '2026-05-05T09:00:00.000Z',
      },
    ]);
  });

  it('does not persist across a new store instance', () => {
    const firstContext = createContext();
    const secondContext = createContext();

    executeSetReminder({ message: 'One', scheduled_for: '2026-05-05T09:00:00.000Z' }, firstContext);

    expect(secondContext.reminderStore.reminders).toEqual([]);
  });

  it('rejects invalid input', () => {
    expect(() =>
      executeSetReminder(
        { message: '', scheduled_for: '2026-05-05T09:00:00.000Z' },
        createContext(),
      ),
    ).toThrow(/message/);
    expect(() =>
      executeSetReminder({ message: 'A', scheduled_for: 'not-a-date' }, createContext()),
    ).toThrow(/valid ISO/);
  });
});
