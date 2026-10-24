import { describe, expect, it } from 'vitest';

import { compareWithPrevious } from '../../src/domain/export-size.js';

const previous = { entryCount: 198, jobId: '2026-10', sizeBytes: 8_907_221 };
const shrink = { previousEntryCount: 198, previousJobId: '2026-10', previousSizeBytes: 8_907_221 };

describe('compareWithPrevious', () => {
  it('flags the Step 16 export: 3 files and 1,104 bytes against 198 files and 8.9 MB', () => {
    expect(compareWithPrevious({ entryCount: 3, sizeBytes: 1104 }, previous)).toEqual(shrink);
  });

  it('flags fewer than half the files, even at the same size', () => {
    expect(compareWithPrevious({ entryCount: 98, sizeBytes: 8_907_221 }, previous)).toEqual(shrink);
  });

  it('flags less than half the size, even with the same files', () => {
    expect(compareWithPrevious({ entryCount: 198, sizeBytes: 4_453_610 }, previous)).toEqual(
      shrink,
    );
  });

  it('does not flag exactly half the files or exactly half the size', () => {
    expect(compareWithPrevious({ entryCount: 99, sizeBytes: 9_000_000 }, previous)).toBeUndefined();
    expect(
      compareWithPrevious(
        { entryCount: 300, sizeBytes: 4_453_611 },
        { ...previous, sizeBytes: 8_907_222 },
      ),
    ).toBeUndefined();
  });

  it('does not flag a growing or similar backup', () => {
    expect(
      compareWithPrevious({ entryCount: 210, sizeBytes: 9_500_000 }, previous),
    ).toBeUndefined();
  });

  it('compares only the sizes when either side has no file count', () => {
    const adopted = { sizeBytes: 8_000_000 };
    const { entryCount: _count, ...withoutCount } = previous;

    expect(compareWithPrevious(adopted, previous)).toBeUndefined();
    expect(
      compareWithPrevious({ entryCount: 3, sizeBytes: 8_000_000 }, withoutCount),
    ).toBeUndefined();
    expect(compareWithPrevious({ entryCount: 3, sizeBytes: 1104 }, withoutCount)).toEqual({
      previousJobId: '2026-10',
      previousSizeBytes: 8_907_221,
    });
  });

  it('honours another ratio', () => {
    expect(compareWithPrevious({ entryCount: 150, sizeBytes: 8_907_221 }, previous, 0.8)).toEqual(
      shrink,
    );
  });

  it.each([0, 1, -0.5, Number.NaN])('refuses the ratio %s', (ratio) => {
    expect(() => compareWithPrevious({ sizeBytes: 1 }, previous, ratio)).toThrow(RangeError);
  });
});
