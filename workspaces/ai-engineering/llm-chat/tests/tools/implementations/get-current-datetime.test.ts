import { describe, expect, it } from 'vitest';

import { getCurrentDatetimeTool } from '../../../src/tools/implementations/get-current-datetime.js';
import type { AppToolExecutionContext } from '../../../src/tools/types.js';

const context: AppToolExecutionContext = {
  now: () => new Date('2026-05-04T12:00:00.000Z'),
  reminderStore: { reminders: [] },
};

describe('get_current_datetime', () => {
  it('uses the injected clock for deterministic ISO output', () => {
    expect(getCurrentDatetimeTool.execute({}, context)).toEqual({
      iso_datetime: '2026-05-04T12:00:00.000Z',
    });
  });

  it('can return human-readable output', () => {
    expect(
      getCurrentDatetimeTool.execute(
        { format: 'human', locale: 'en-US', timeZone: 'UTC' },
        context,
      ),
    ).toEqual({
      human_datetime: 'Monday, May 4, 2026 at 12:00:00 PM UTC',
      iso_datetime: '2026-05-04T12:00:00.000Z',
    });
  });
});
