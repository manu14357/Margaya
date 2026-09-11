import { isValidDateString, shiftDate } from "../utils/calendar-date";

// Calendar-day math for date filters. Task dates are instants written at the
// requester's local midnight, so a day D in zone Z is the half-open instant
// range [midnight of D in Z, midnight of D + 1 in Z). Days are "YYYY-MM-DD"
// strings; ranges of days are half-open too, and a null end is unbounded.

export const WEEK_STARTS = [0, 1, 6] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

export const DATE_UNITS = ["days", "weeks", "months"] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

export const DATE_PRESETS = [
  "today",
  "yesterday",
  "tomorrow",
  "thisWeek",
  "lastWeek",
  "nextWeek",
  "thisMonth",
  "lastMonth",
  "nextMonth",
  "past",
  "future",
  "none",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const ROLLING_OPERATORS = [
  "withinLast",
  "withinNext",
  "moreThanAgo",
  "moreThanAhead",
] as const;
export type RollingOperator = (typeof ROLLING_OPERATORS)[number];

/** Calendar days [from, until); null means unbounded on that side. */
export type DayRange = { from: string | null; until: string | null };

/** Instants [gte, lt); null means unbounded on that side. */
export type InstantRange = { gte: Date | null; lt: Date | null };

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;
const DAY_PATTERN = /^(\d+)-(\d{2})-(\d{2})$/;

export function isValidDay(value: string): boolean {
  return isValidDateString(value);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** True when `Intl` knows the IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

// Date.UTC maps years 0–99 onto 1900–1999, so set the full year explicitly.
function utcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function parseDay(day: string): [number, number, number] {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Invalid day: ${day}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallClock(instant: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function wallDay(instant: number, timeZone: string): string {
  const clock = wallClock(instant, timeZone);
  return formatDay(clock.year, clock.month, clock.day);
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const floored = instant - (((instant % SECOND_MS) + SECOND_MS) % SECOND_MS);
  return (
    utcMs(
      clock.year,
      clock.month,
      clock.day,
      clock.hour,
      clock.minute,
      clock.second,
    ) - floored
  );
}

/** The calendar day of an instant in a zone. */
export function zonedDay(instant: Date, timeZone: string): string {
  return wallDay(instant.getTime(), timeZone);
}

/**
 * The first instant of a calendar day in a zone. Usually local midnight; when
 * a transition skips or repeats midnight, the first instant whose local date
 * is that day (a day skipped entirely starts where the next one does).
 */
export function startOfZonedDay(day: string, timeZone: string): Date {
  const [year, month, date] = parseDay(day);
  const midnightAsUtc = utcMs(year, month, date);

  // Two offset refinements land on local midnight unless a transition sits
  // right there.
  let candidate = midnightAsUtc - offsetAt(midnightAsUtc, timeZone);
  candidate = midnightAsUtc - offsetAt(candidate, timeZone);
  const clock = wallClock(candidate, timeZone);
  if (
    formatDay(clock.year, clock.month, clock.day) === day &&
    clock.hour === 0 &&
    clock.minute === 0 &&
    clock.second === 0 &&
    wallDay(candidate - 1, timeZone) < day
  ) {
    return new Date(candidate);
  }

  // Offsets span −12h to +14h, so the day starts inside this window. Search
  // for the first second whose local date is `day` or later.
  let low = Math.floor((midnightAsUtc - 15 * HOUR_MS) / SECOND_MS);
  let high = Math.ceil((midnightAsUtc + 13 * HOUR_MS) / SECOND_MS);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (wallDay(middle * SECOND_MS, timeZone) >= day) high = middle;
    else low = middle + 1;
  }
  return new Date(low * SECOND_MS);
}

export function addDays(day: string, days: number): string {
  return shiftDate(day, days);
}

function daysInMonth(year: number, month: number): number {
  return new Date(utcMs(year, month + 1, 0)).getUTCDate();
}

/** `day` moved by calendar months, clamped to the target month's last day. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = parseDay(day);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  return formatDay(
    targetYear,
    targetMonth,
    Math.min(date, daysInMonth(targetYear, targetMonth)),
  );
}

function addUnits(day: string, amount: number, unit: DateUnit): string {
  if (unit === "months") return addMonths(day, amount);
  return addDays(day, unit === "weeks" ? amount * 7 : amount);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(day: string): number {
  const [year, month, date] = parseDay(day);
  return new Date(utcMs(year, month, date)).getUTCDay();
}

export function startOfWeek(day: string, weekStartsOn: WeekStart): string {
  return addDays(day, -((dayOfWeek(day) - weekStartsOn + 7) % 7));
}

export function startOfMonth(day: string): string {
  const [year, month] = parseDay(day);
  return formatDay(year, month, 1);
}

/**
 * The days a preset covers relative to `today`; null for `none`, which
 * matches an unset date instead of a range.
 */
export function presetRange(
  preset: DatePreset,
  today: string,
  weekStartsOn: WeekStart,
): DayRange | null {
  const week = startOfWeek(today, weekStartsOn);
  const month = startOfMonth(today);
  switch (preset) {
    case "today":
      return { from: today, until: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), until: today };
    case "tomorrow":
      return { from: addDays(today, 1), until: addDays(today, 2) };
    case "thisWeek":
      return { from: week, until: addDays(week, 7) };
    case "lastWeek":
      return { from: addDays(week, -7), until: week };
    case "nextWeek":
      return { from: addDays(week, 7), until: addDays(week, 14) };
    case "thisMonth":
      return { from: month, until: addMonths(month, 1) };
    case "lastMonth":
      return { from: addMonths(month, -1), until: month };
    case "nextMonth":
      return { from: addMonths(month, 1), until: addMonths(month, 2) };
    case "past":
      return { from: null, until: today };
    case "future":
      return { from: addDays(today, 1), until: null };
    case "none":
      return null;
  }
}

/** Rolling windows around `today`, e.g. "within the last 2 weeks". */
export function rollingRange(
  operator: RollingOperator,
  amount: number,
  unit: DateUnit,
  today: string,
): DayRange {
  switch (operator) {
    // today − amount < day ≤ today
    case "withinLast":
      return {
        from: addDays(addUnits(today, -amount, unit), 1),
        until: addDays(today, 1),
      };
    // today ≤ day < today + amount
    case "withinNext":
      return { from: today, until: addUnits(today, amount, unit) };
    // day < today − amount
    case "moreThanAgo":
      return { from: null, until: addUnits(today, -amount, unit) };
    // day > today + amount
    case "moreThanAhead":
      return { from: addDays(addUnits(today, amount, unit), 1), until: null };
  }
}

/** The instant bounds of a day range in a zone. */
export function toInstantRange(
  range: DayRange,
  timeZone: string,
): InstantRange {
  return {
    gte: range.from === null ? null : startOfZonedDay(range.from, timeZone),
    lt: range.until === null ? null : startOfZonedDay(range.until, timeZone),
  };
}
