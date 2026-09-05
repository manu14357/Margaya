// Date-only values ("YYYY-MM-DD") without a time zone, as used by cycle and
// module dates. "Today" is the server's UTC calendar date, so results never
// depend on where the caller is. Date strings compare correctly as plain
// strings.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parseParts(value: string): [number, number, number] | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Date.UTC maps years 0–99 onto 1900–1999, so set the full year explicitly.
function utcMidnight(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function toUtcDate(value: string): Date {
  const parts = parseParts(value);
  if (!parts) throw new Error(`Invalid date string: ${value}`);
  return utcMidnight(...parts);
}

function formatUtcDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** True for a real calendar date in `YYYY-MM-DD` form (year 1 or later). */
export function isValidDateString(value: string): boolean {
  const parts = parseParts(value);
  if (!parts) return false;
  const [year, month, day] = parts;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = utcMidnight(year, month, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** The UTC calendar date of `now`. */
export function todayUtc(now: Date = new Date()): string {
  return formatUtcDate(now);
}

/** The UTC calendar date of a timestamp. */
export function utcDateOf(timestamp: Date): string {
  return formatUtcDate(timestamp);
}

/** `date` moved by `days` calendar days. */
export function shiftDate(date: string, days: number): string {
  return formatUtcDate(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}

/** end − start in days: 0 for a single-day range. */
export function daySpan(startDate: string, endDate: string): number {
  return Math.round(
    (toUtcDate(endDate).getTime() - toUtcDate(startDate).getTime()) / DAY_MS,
  );
}

/** Every calendar date from start to end, inclusive. */
export function listDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const span = daySpan(startDate, endDate);
  for (let offset = 0; offset <= span; offset++) {
    days.push(shiftDate(startDate, offset));
  }
  return days;
}
