import { describe, expect, it } from 'vitest';

import { addDurationToDatetimeTool } from '../../../src/tools/implementations/add-duration-to-datetime.js';
import type { AppToolExecutionContext } from '../../../src/tools/types.js';

const context: AppToolExecutionContext = {
  now: () => new Date('2026-05-04T12:00:00.000Z'),
  reminderStore: { reminders: [] },
};

describe('add_duration_to_datetime', () => {
  it.each([
    ['seconds', 1, '2026-05-04T12:00:01.000Z'],
    ['minutes', 1, '2026-05-04T12:01:00.000Z'],
    ['hours', 1, '2026-05-04T13:00:00.000Z'],
    ['days', 1, '2026-05-05T12:00:00.000Z'],
    ['weeks', 1, '2026-05-11T12:00:00.000Z'],
    ['months', 1, '2026-06-04T12:00:00.000Z'],
    ['years', 1, '2027-05-04T12:00:00.000Z'],
  ])('adds %s', (unit, amount, resultDatetime) => {
    expect(
      addDurationToDatetimeTool.execute(
        { amount, datetime: '2026-05-04T12:00:00.000Z', unit },
        context,
      ),
    ).toMatchObject({
      result_datetime: resultDatetime,
    });
  });

  it('supports negative durations', () => {
    expect(
      addDurationToDatetimeTool.execute(
        { amount: -2, datetime: '2026-05-04T12:00:00.000Z', unit: 'days' },
        context,
      ),
    ).toMatchObject({
      result_datetime: '2026-05-02T12:00:00.000Z',
    });
  });

  it('clamps month-end results to the target month', () => {
    expect(
      addDurationToDatetimeTool.execute(
        { amount: 1, datetime: '2024-01-31T12:00:00.000Z', unit: 'months' },
        context,
      ),
    ).toMatchObject({
      result_datetime: '2024-02-29T12:00:00.000Z',
    });
  });

  it('rejects invalid datetimes and unsupported units', () => {
    expect(() =>
      addDurationToDatetimeTool.execute(
        { amount: 1, datetime: 'not-a-date', unit: 'days' },
        context,
      ),
    ).toThrow(/valid ISO/);
    expect(() =>
      addDurationToDatetimeTool.execute(
        { amount: 1, datetime: '2026-05-04T12:00:00.000Z', unit: 'fortnights' },
        context,
      ),
    ).toThrow(/unit must be one of/);
  });
});
