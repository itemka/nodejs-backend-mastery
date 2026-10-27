import { z } from 'zod';

/** A backup period, `YYYY-MM`: one normal job and one backup per period. */
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export type Period = z.infer<typeof periodSchema>;

interface LocalDate {
  day: string;
  month: string;
  year: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localDateParts(now: Date, timeZone: string): LocalDate {
  let formatter = formatters.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      calendar: 'iso8601',
      day: '2-digit',
      month: '2-digit',
      numberingSystem: 'latn',
      timeZone,
      year: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

  return { day: parts.day ?? '', month: parts.month ?? '', year: parts.year ?? '' };
}

/**
 * The period of "now" in the backup time zone. Periods are always derived server-side from the
 * current time, so no job can be started for a past or future month.
 */
export function periodFor(now: Date, timeZone: string): Period {
  const { month, year } = localDateParts(now, timeZone);

  return periodSchema.parse(`${year}-${month}`);
}

/** The local calendar date, `YYYY-MM-DD`, in the backup time zone. */
export function localDateFor(now: Date, timeZone: string): string {
  const { day, month, year } = localDateParts(now, timeZone);

  return `${year}-${month}-${day}`;
}

/**
 * The instant a local calendar day, `YYYY-MM-DD`, starts in `timeZone`: `2026-10-18` in
 * Europe/Warsaw is `2026-10-17T22:00:00Z`. Two estimates use the offset at UTC midnight and at
 * the first estimate; the earliest one that falls on the day wins. That covers a DST change at
 * midnight, when the day starts at 01:00.
 */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  const utcMidnight = Date.parse(`${localDate}T00:00:00.000Z`);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || Number.isNaN(utcMidnight)) {
    throw new RangeError('Expected a local date, YYYY-MM-DD');
  }

  const first = utcMidnight - offsetMs(new Date(utcMidnight), timeZone);
  const second = utcMidnight - offsetMs(new Date(first), timeZone);
  const onTheDay = [first, second].filter(
    (ms) => localDateFor(new Date(ms), timeZone) === localDate,
  );

  return new Date(Math.min(...(onTheDay.length > 0 ? onTheDay : [second])));
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's UTC offset at `instant`, from its `GMT+02:00` name; `GMT` alone is zero. */
function offsetMs(instant: Date, timeZone: string): number {
  let formatter = offsetFormatters.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    offsetFormatters.set(timeZone, formatter);
  }

  const name = formatter.formatToParts(instant).find((part) => part.type === 'timeZoneName');
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name?.value ?? '');

  if (match === null) {
    return 0;
  }

  const minutes = Number(match[2]) * 60 + Number(match[3]);

  return (match[1] === '-' ? -minutes : minutes) * 60_000;
}

/** The monthly auto-start is due from the local `dayOfMonth` to the end of the month. */
export function isAutoStartDue(now: Date, timeZone: string, dayOfMonth: number): boolean {
  return Number(localDateParts(now, timeZone).day) >= dayOfMonth;
}

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The scheduled Notion probe runs on Mondays and two days before the backup day, both local, so
 * a lost session or a changed Settings page shows up before the backup needs them. "Two days"
 * are calendar days, not 48 hours, which a DST change would shift by a day.
 */
export function isNotionProbeDay(now: Date, timeZone: string, backupDayOfMonth: number): boolean {
  let formatter = weekdayFormatters.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
    weekdayFormatters.set(timeZone, formatter);
  }

  const { day, month, year } = localDateParts(now, timeZone);
  // Calendar arithmetic on the local date; Date.UTC rolls over a month or year end.
  const inTwoDays = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day) + 2),
  ).getUTCDate();

  return formatter.format(now) === 'Mon' || inTwoDays === backupDayOfMonth;
}

export function yearOfPeriod(period: Period): string {
  return period.slice(0, 4);
}
