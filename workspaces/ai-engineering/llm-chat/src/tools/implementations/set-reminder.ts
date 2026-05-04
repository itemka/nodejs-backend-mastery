import type { AppTool } from '../types.js';

interface SetReminderInput {
  readonly message: string;
  readonly scheduled_for: string;
}

function parseInput(input: unknown): SetReminderInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('input must be an object.');
  }

  const value = input as Record<string, unknown>;

  if (typeof value.message !== 'string' || value.message.trim() === '') {
    throw new TypeError('message must be a non-empty string.');
  }

  if (typeof value.scheduled_for !== 'string') {
    throw new TypeError('scheduled_for must be an ISO 8601 string.');
  }

  const scheduledFor = new Date(value.scheduled_for);

  if (Number.isNaN(scheduledFor.getTime())) {
    throw new TypeError('scheduled_for must be a valid ISO 8601 string.');
  }

  return {
    message: value.message.trim(),
    scheduled_for: scheduledFor.toISOString(),
  };
}

export const setReminderTool: AppTool = {
  definition: {
    description:
      'Create a mock reminder in process memory only. This tool does not persist reminders and does not schedule real notifications.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        message: {
          description: 'Reminder text.',
          type: 'string',
        },
        scheduled_for: {
          description: 'Reminder datetime as an ISO 8601 string.',
          type: 'string',
        },
      },
      required: ['message', 'scheduled_for'],
      type: 'object',
    },
    name: 'set_reminder',
  },
  execute(input, context) {
    const parsed = parseInput(input);
    const id = `reminder-${context.reminderStore.reminders.length + 1}`;

    context.reminderStore.reminders.push({
      id,
      message: parsed.message,
      scheduledFor: parsed.scheduled_for,
    });

    return {
      id,
      message: parsed.message,
      scheduled_for: parsed.scheduled_for,
      storage: 'process-local',
      total_reminders: context.reminderStore.reminders.length,
    };
  },
};
