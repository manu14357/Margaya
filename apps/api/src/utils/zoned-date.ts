// Pure IANA time-zone date helpers built on `Intl` only (no database).
// utils/timezone.ts re-exports them next to the zone lookups.

export const DEFAULT_TIMEZONE = "UTC";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TIMEZONE_LENGTH = 64;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      era: "short",
    });
    formatterCache.set(tz, formatter);
  }
  return formatter;
}

/**
 * True for a named IANA zone `Intl` knows ("Europe/Berlin", "UTC").
 * Raw offsets such as "+05:30" are rejected: they ignore DST.
 */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string") return false;
  if (tz.length === 0 || tz.length > MAX_TIMEZONE_LENGTH) return false;
  if (/^[+-]/.test(tz)) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** The zone's own spelling ("utc" → "UTC"); input must be valid. */
export function normalizeTimezone(tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions()
    .timeZone;
}

/** A stored zone, or UTC when it is missing or no longer recognised. */
export function resolveTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(date: Date, tz: string): LocalParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(tz).formatToParts(date)) {
    values[part.type] = part.value;
  }
  const yearOfEra = Number(values.year);
  return {
    // Proleptic years before 1 CE come back as "BC" eras.
    year: values.era === "BC" ? 1 - yearOfEra : yearOfEra,
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

// Date.UTC maps years 0–99 onto 1900–1999, so set the full year explicitly.
function utcInstant(parts: LocalParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

/** Local wall-clock minus UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, tz: string): number {
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  return utcInstant(localParts(new Date(wholeSecond), tz)) - wholeSecond;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The calendar date (`YYYY-MM-DD`) of `date` in zone `tz`. */
export function localDateString(date: Date, tz: string): string {
  const { year, month, day } = localParts(date, tz);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Today's calendar date in zone `tz`. */
export function todayInTimezone(tz: string, now: Date = new Date()): string {
  return localDateString(now, tz);
}

/**
 * Wall-clock fields of `date` in zone `tz`: calendar date plus time of day.
 * Months are 1-based.
 */
export function localDateTimeParts(date: Date, tz: string): LocalParts {
  return localParts(date, tz);
}

/**
 * The UTC instant showing wall-clock `parts` in zone `tz`. A time skipped by
 * a DST jump maps to the instant just after the jump; a repeated time maps
 * to its first occurrence.
 */
export function zonedTimeToUtc(
  parts: LocalParts & { millisecond?: number },
  tz: string,
): Date {
  const wallClock = utcInstant(parts);
  const first = wallClock - offsetAt(wallClock, tz);
  const second = wallClock - offsetAt(first, tz);
  const exact = [first, second].filter(
    (instant) => utcInstant(localParts(new Date(instant), tz)) === wallClock,
  );
  const instant =
    exact.length > 0 ? Math.min(...exact) : Math.max(first, second);
  return new Date(instant + (parts.millisecond ?? 0));
}

/**
 * The UTC instant at which calendar day `dateString` begins in zone `tz`.
 * Normally local midnight; when a DST jump skips midnight it is the first
 * instant that falls on that day.
 */
export function startOfLocalDayUtc(dateString: string, tz: string): Date {
  const match = DATE_PATTERN.exec(dateString);
  if (!match) throw new Error(`Invalid date string: ${dateString}`);
  const wallClock = utcInstant({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  });

  // Two passes settle the offset for every zone; around a transition the
  // candidates differ and only the one that lands on the right day counts.
  const first = wallClock - offsetAt(wallClock, tz);
  const second = wallClock - offsetAt(first, tz);
  const onDay = [first, second].filter(
    (instant) => localDateString(new Date(instant), tz) === dateString,
  );
  return new Date(onDay.length > 0 ? Math.min(...onDay) : first);
}

/** The UTC instant at which the day after `dateString` begins in `tz`. */
export function startOfNextLocalDayUtc(dateString: string, tz: string): Date {
  const start = startOfLocalDayUtc(dateString, tz);
  // 26 h past local midnight is always inside the next day (max DST shift).
  const nextDay = localDateString(
    new Date(start.getTime() + 26 * 3_600_000),
    tz,
  );
  return startOfLocalDayUtc(nextDay, tz);
}
