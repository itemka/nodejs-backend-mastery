import { describe, expect, it } from 'vitest';

import {
  isAutoStartDue,
  isNotionProbeDay,
  localDateFor,
  periodFor,
  startOfLocalDay,
  yearOfPeriod,
} from '../../src/domain/period.js';

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

describe('startOfLocalDay', () => {
  it.each([
    ['a summer day, CEST (+2)', '2026-10-18', warsaw, '2026-10-17T22:00:00.000Z'],
    ['a winter day, CET (+1)', '2026-12-01', warsaw, '2026-11-30T23:00:00.000Z'],
    ['the day summer time ends', '2026-10-25', warsaw, '2026-10-24T22:00:00.000Z'],
    ['the day after it ends', '2026-10-26', warsaw, '2026-10-25T23:00:00.000Z'],
    ['the day summer time starts', '2026-03-29', warsaw, '2026-03-28T23:00:00.000Z'],
    ['UTC', '2026-10-18', 'UTC', '2026-10-18T00:00:00.000Z'],
    ['a zone west of UTC', '2026-10-18', 'America/New_York', '2026-10-18T04:00:00.000Z'],
    ['a half-hour offset', '2026-10-18', 'Asia/Kolkata', '2026-10-17T18:30:00.000Z'],
    [
      'a day that starts at a DST change',
      '2026-09-06',
      'America/Santiago',
      '2026-09-06T04:00:00.000Z',
    ],
  ])('%s', (_case, localDate, timeZone, expected) => {
    const start = startOfLocalDay(localDate, timeZone);

    expect(start.toISOString()).toBe(expected);
    expect(localDateFor(start, timeZone)).toBe(localDate);
    expect(localDateFor(new Date(start.getTime() - 1), timeZone)).not.toBe(localDate);
  });

  it('rejects anything but a date', () => {
    expect(() => startOfLocalDay('2026-10', warsaw)).toThrow(RangeError);
    expect(() => startOfLocalDay('yesterday', warsaw)).toThrow(RangeError);
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

describe('isNotionProbeDay', () => {
  it('is Mondays in the backup time zone', () => {
    // Sunday 23:30 UTC is already Monday in Warsaw.
    expect(isNotionProbeDay(utc('2026-10-11T23:30:00Z'), warsaw, 20)).toBe(true);
    expect(isNotionProbeDay(utc('2026-10-12T04:00:00Z'), warsaw, 20)).toBe(true);
    expect(isNotionProbeDay(utc('2026-10-13T04:00:00Z'), warsaw, 20)).toBe(false);
  });

  it('is two days before the backup day, across a month end', () => {
    expect(isNotionProbeDay(utc('2026-10-08T04:00:00Z'), warsaw, 10)).toBe(true);
    expect(isNotionProbeDay(utc('2026-10-09T04:00:00Z'), warsaw, 10)).toBe(false);
    // Friday 30 October: 1 November is two days later.
    expect(isNotionProbeDay(utc('2026-10-30T04:00:00Z'), warsaw, 1)).toBe(true);
    expect(isNotionProbeDay(utc('2026-10-29T04:00:00Z'), warsaw, 1)).toBe(false);
  });

  it('counts calendar days, not 48 hours, across a DST change', () => {
    const newYork = 'America/New_York';

    // Saturday 31 October, 00:00 EDT: 2 November is two days later, though 48 hours later it
    // is still 1 November (23:00 EST).
    expect(isNotionProbeDay(utc('2026-10-31T04:00:00Z'), newYork, 2)).toBe(true);
    expect(isNotionProbeDay(utc('2026-11-01T04:00:00Z'), newYork, 2)).toBe(false);
    // Friday 6 March, 23:00 EST: 8 March is two days later, though 48 hours later it is
    // already 9 March (00:00 EDT).
    expect(isNotionProbeDay(utc('2026-03-07T04:00:00Z'), newYork, 8)).toBe(true);
    expect(isNotionProbeDay(utc('2026-03-07T04:00:00Z'), newYork, 9)).toBe(false);
  });
});
