import { describe, expect, it } from 'vitest';

import { isAutoStartDue, localDateFor, periodFor, yearOfPeriod } from '../../src/domain/period.js';

const warsaw = 'Europe/Warsaw';
const utc = (iso: string) => new Date(iso);

describe('periodFor and localDateFor (Europe/Warsaw)', () => {
  it.each([
    ['the daily cron on the first, CEST', '2026-10-01T04:00:00Z', '2026-10', '2026-10-01'],
    ['the last minute of October, CET (+1)', '2026-10-31T22:59:00Z', '2026-10', '2026-10-31'],
    [
      'already November locally, still October in UTC',
      '2026-10-31T23:30:00Z',
      '2026-11',
      '2026-11-01',
    ],
    ['already 2027 locally, still 2026 in UTC', '2026-12-31T23:30:00Z', '2027-01', '2027-01-01'],
    [
      'April locally right after the spring DST change (CEST, +2)',
      '2026-03-31T22:30:00Z',
      '2026-04',
      '2026-04-01',
    ],
    [
      'the same UTC time one day earlier is still March',
      '2026-03-30T22:30:00Z',
      '2026-03',
      '2026-03-31',
    ],
    ['02:30 CEST, before the autumn change', '2026-10-25T00:30:00Z', '2026-10', '2026-10-25'],
    ['02:30 CET, the repeated hour after it', '2026-10-25T01:30:00Z', '2026-10', '2026-10-25'],
    [
      '02:30 on the spring change day, a skipped local hour',
      '2026-03-29T01:30:00Z',
      '2026-03',
      '2026-03-29',
    ],
  ])('%s', (_case, iso, period, localDate) => {
    expect(periodFor(utc(iso), warsaw)).toBe(period);
    expect(localDateFor(utc(iso), warsaw)).toBe(localDate);
  });

  it('follows the configured time zone', () => {
    expect(periodFor(utc('2026-10-31T23:30:00Z'), 'UTC')).toBe('2026-10');
    expect(periodFor(utc('2026-10-31T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-11');
  });
});

describe('isAutoStartDue', () => {
  it('is due from the local backup day to the end of the month', () => {
    expect(isAutoStartDue(utc('2026-10-31T23:30:00Z'), warsaw, 1)).toBe(true);
    expect(isAutoStartDue(utc('2026-10-14T04:00:00Z'), warsaw, 15)).toBe(false);
    expect(isAutoStartDue(utc('2026-10-14T22:30:00Z'), warsaw, 15)).toBe(true);
    expect(isAutoStartDue(utc('2026-10-28T04:00:00Z'), warsaw, 28)).toBe(true);
  });
});

describe('yearOfPeriod', () => {
  it('returns the year', () => {
    expect(yearOfPeriod('2027-01')).toBe('2027');
  });
});
