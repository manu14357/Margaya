import { daySpan, shiftDate } from "../utils/calendar-date";
import {
  type LocalParts,
  localDateTimeParts,
  zonedTimeToUtc,
} from "../utils/zoned-date";

// Pure recurrence math on workspace-local calendar dates ("YYYY-MM-DD").
// Occurrences count from the rule's anchor (the current instance's date), so
// an interval of 2 keeps its rhythm when the rule moves to the next task.

export const RECURRENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const RECURRENCE_TRIGGERS = ["completion", "schedule"] as const;
export type RecurrenceTrigger = (typeof RECURRENCE_TRIGGERS)[number];

export const MAX_RECURRENCE_INTERVAL = 365;
export const MAX_RECURRENCE_OCCURRENCES = 1000;

export type RecurrencePattern = {
  frequency: RecurrenceFrequency;
  interval: number;
  /** Weekly: 0 Sunday to 6 Saturday; empty or null means the anchor's day. */
  weekdays: number[] | null;
  /** Monthly and yearly: 1 to 31, clamped to the month; null means the anchor's day. */
  monthDay: number | null;
  anchorDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  occurrenceCount: number;
};

type YearMonthDay = { year: number; month: number; day: number };

function parse(date: string): YearMonthDay {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
}

function format({ year, month, day }: YearMonthDay): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/** 0 Sunday to 6 Saturday. */
export function weekdayOf(date: string): number {
  const { year, month, day } = parse(date);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  return value.getUTCDay();
}

function laterOf(a: string, b: string): string {
  return a > b ? a : b;
}

/** The month `offset` months after year/month, on `day` clamped to it. */
function monthAt(base: YearMonthDay, offset: number, day: number): string {
  const index = base.year * 12 + (base.month - 1) + offset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return format({ year, month, day: Math.min(day, daysInMonth(year, month)) });
}

/**
 * The first occurrence of the pattern strictly after `after` (and never
 * before the anchor), ignoring the end date and the count.
 */
export function occurrenceAfter(
  pattern: Pick<
    RecurrencePattern,
    "frequency" | "interval" | "weekdays" | "monthDay" | "anchorDate"
  >,
  after: string,
): string {
  const interval = Math.max(1, Math.floor(pattern.interval));
  const anchor = pattern.anchorDate;

  switch (pattern.frequency) {
    case "daily": {
      const diff = daySpan(anchor, after);
      if (diff < 0) return anchor;
      return shiftDate(anchor, (Math.floor(diff / interval) + 1) * interval);
    }
    case "weekly": {
      const days = new Set(
        pattern.weekdays && pattern.weekdays.length > 0
          ? pattern.weekdays
          : [weekdayOf(anchor)],
      );
      // Weeks start on Sunday; the anchor's week is week 0.
      const anchorWeekStart = shiftDate(anchor, -weekdayOf(anchor));
      let date = shiftDate(laterOf(after, shiftDate(anchor, -1)), 1);
      // Every 7 × interval days hold at least one match.
      for (let step = 0; step <= 7 * interval + 7; step++) {
        const week = Math.floor(daySpan(anchorWeekStart, date) / 7);
        if (week % interval === 0 && days.has(weekdayOf(date))) return date;
        date = shiftDate(date, 1);
      }
      // Unreachable with a non-empty weekday set.
      return shiftDate(after, 7 * interval);
    }
    case "monthly":
    case "yearly": {
      const base = parse(anchor);
      const day = pattern.monthDay ?? base.day;
      const step = pattern.frequency === "monthly" ? interval : 12 * interval;
      const target = parse(after);
      const monthsApart =
        (target.year - base.year) * 12 + (target.month - base.month);
      let k = Math.max(0, Math.floor(monthsApart / step) - 1);
      for (;;) {
        const date = monthAt(base, k * step, day);
        if (date > after && date >= anchor) return date;
        k += 1;
      }
    }
  }
}

/** True when one more instance after the current one is allowed. */
export function withinLimits(
  pattern: Pick<
    RecurrencePattern,
    "endDate" | "maxOccurrences" | "occurrenceCount"
  >,
  date: string,
): boolean {
  if (
    pattern.maxOccurrences !== null &&
    pattern.occurrenceCount >= pattern.maxOccurrences
  ) {
    return false;
  }
  return pattern.endDate === null || date <= pattern.endDate;
}

/**
 * The date of the instance a completion creates: the first occurrence after
 * both the current one and today, so a late completion never creates an
 * instance that is overdue already. Null when the series has ended.
 */
export function nextOnCompletion(
  pattern: RecurrencePattern,
  today: string,
): string | null {
  const date = occurrenceAfter(pattern, laterOf(pattern.anchorDate, today));
  return withinLimits(pattern, date) ? date : null;
}

/** The schedule trigger's next run: the occurrence after the anchor. */
export function nextScheduledRun(pattern: RecurrencePattern): string | null {
  const date = occurrenceAfter(pattern, pattern.anchorDate);
  return withinLimits(pattern, date) ? date : null;
}

/**
 * The date of the instance a due scheduled run creates. Runs missed while
 * the server was down collapse into the latest occurrence on or before
 * today, so a backlog never floods the board.
 */
export function scheduledTarget(
  pattern: RecurrencePattern,
  nextRunDate: string,
  today: string,
): string {
  let target = nextRunDate;
  for (let i = 0; i < MAX_RECURRENCE_OCCURRENCES; i++) {
    const next = occurrenceAfter(pattern, target);
    if (next > today || (pattern.endDate !== null && next > pattern.endDate)) {
      break;
    }
    target = next;
  }
  return target;
}

/**
 * Moves a timestamp by whole calendar days in `tz`, keeping its wall-clock
 * time there (a due date at local midnight stays at local midnight across a
 * DST change).
 */
export function shiftInstantByDays(
  instant: Date,
  days: number,
  tz: string,
): Date {
  if (days === 0) return instant;
  const parts: LocalParts = localDateTimeParts(instant, tz);
  const shifted = parse(
    shiftDate(
      format({ year: parts.year, month: parts.month, day: parts.day }),
      days,
    ),
  );
  return zonedTimeToUtc(
    {
      ...parts,
      year: shifted.year,
      month: shifted.month,
      day: shifted.day,
      millisecond: instant.getUTCMilliseconds(),
    },
    tz,
  );
}
