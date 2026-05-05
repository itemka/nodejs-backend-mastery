import type { AppTool } from '../types.js';

const DURATION_UNITS = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const;

type DurationUnit = (typeof DURATION_UNITS)[number];

interface AddDurationInput {
  readonly amount: number;
  readonly datetime: string;
  readonly unit: DurationUnit;
}

const MILLISECONDS_BY_UNIT = {
  days: 24 * 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  minutes: 60 * 1000,
  seconds: 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
} satisfies Partial<Record<DurationUnit, number>>;

function isDurationUnit(value: unknown): value is DurationUnit {
  return typeof value === 'string' && DURATION_UNITS.includes(value as DurationUnit);
}

function parseInput(input: unknown): AddDurationInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('input must be an object.');
  }

  const value = input as Record<string, unknown>;

  if (typeof value.datetime !== 'string') {
    throw new TypeError('datetime must be an ISO 8601 string.');
  }

  if (typeof value.amount !== 'number' || !Number.isInteger(value.amount)) {
    throw new TypeError('amount must be an integer.');
  }

  if (!isDurationUnit(value.unit)) {
    throw new Error('unit must be one of: seconds, minutes, hours, days, weeks, months, years.');
  }

  return {
    amount: value.amount,
    datetime: value.datetime,
    unit: value.unit,
  };
}

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('datetime must be a valid ISO 8601 string.');
  }
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUtcMonths(date: Date, amount: number): Date {
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + amount;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12;
  const targetDay = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function addDuration(input: AddDurationInput): Date {
  const date = new Date(input.datetime);
  assertValidDate(date);

  if (input.unit === 'months') {
    return addUtcMonths(date, input.amount);
  }

  if (input.unit === 'years') {
    return addUtcMonths(date, input.amount * 12);
  }

  return new Date(date.getTime() + input.amount * MILLISECONDS_BY_UNIT[input.unit]);
}

export const addDurationToDatetimeTool: AppTool = {
  definition: {
    description:
      'Add or subtract a duration from an ISO 8601 datetime. Use negative amounts to subtract time.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        amount: {
          description: 'Integer amount to add. Negative values subtract the duration.',
          type: 'integer',
        },
        datetime: {
          description: 'Base datetime as an ISO 8601 string.',
          type: 'string',
        },
        unit: {
          description: 'Duration unit.',
          enum: DURATION_UNITS,
          type: 'string',
        },
      },
      required: ['datetime', 'amount', 'unit'],
      type: 'object',
    },
    name: 'add_duration_to_datetime',
  },
  execute(input) {
    const parsed = parseInput(input);
    const result = addDuration(parsed);

    return {
      amount: parsed.amount,
      input_datetime: parsed.datetime,
      result_datetime: result.toISOString(),
      unit: parsed.unit,
    };
  },
};
