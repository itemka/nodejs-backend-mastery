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

/** The monthly auto-start is due from the local `dayOfMonth` to the end of the month. */
export function isAutoStartDue(now: Date, timeZone: string, dayOfMonth: number): boolean {
  return Number(localDateParts(now, timeZone).day) >= dayOfMonth;
}

export function yearOfPeriod(period: Period): string {
  return period.slice(0, 4);
}
