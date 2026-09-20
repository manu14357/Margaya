import { addDays, parseISO, subMonths } from "date-fns";
import { daysBetween, toCycleDateString } from "@/lib/cycle/dates";
import type { AnalyticsDateBucket } from "@/types/analytics";

// Trend periods (B8 §1.4). Every range is a pair of inclusive local days
// (YYYY-MM-DD) counted back from `today`.

export const PERIOD_PRESETS = [
  "last30",
  "last90",
  "last6m",
  "last12m",
  "custom",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type DateRange = { from: string; to: string };

export const DEFAULT_PERIOD: PeriodPreset = "last90";

/** Weeks up to this many days, months beyond (the default bucket). */
export const WEEK_DEFAULT_MAX_DAYS = 90;
/** Weeks are offered up to two years (the API allows 106 weeks). */
export const WEEK_MAX_DAYS = 731;
/** The API's longest range: five years. */
export const MAX_RANGE_DAYS = 1830;

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return (
    typeof value === "string" &&
    (PERIOD_PRESETS as readonly string[]).includes(value)
  );
}

/** The browser's local calendar day, which the API's `today` matches. */
export function localToday(now = new Date()): string {
  return toCycleDateString(now);
}

/** A preset's range ending today; `custom` falls back to the last 90 days. */
export function presetRange(preset: PeriodPreset, today: string): DateRange {
  const end = parseISO(today);
  const from = (() => {
    switch (preset) {
      case "last30":
        return addDays(end, -29);
      case "last6m":
        return addDays(subMonths(end, 6), 1);
      case "last12m":
        return addDays(subMonths(end, 12), 1);
      default:
        return addDays(end, -89);
    }
  })();
  return { from: toCycleDateString(from), to: today };
}

/** Days in a range, both ends included. */
export function spanDays(range: DateRange): number {
  return daysBetween(range.from, range.to) + 1;
}

export function weekAllowed(range: DateRange): boolean {
  return spanDays(range) <= WEEK_MAX_DAYS;
}

/** Week for periods up to 90 days, else month. */
export function defaultBucket(range: DateRange): AnalyticsDateBucket {
  return spanDays(range) <= WEEK_DEFAULT_MAX_DAYS ? "week" : "month";
}

/** The chosen bucket, unless weeks are not allowed for the range. */
export function effectiveBucket(
  range: DateRange,
  chosen: AnalyticsDateBucket | null,
): AnalyticsDateBucket {
  const bucket = chosen ?? defaultBucket(range);
  return bucket === "week" && !weekAllowed(range) ? "month" : bucket;
}

/** The API's most month buckets. */
export const MAX_MONTH_BUCKETS = 60;

function monthIndex(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
}

/**
 * Orders a picked range and keeps it within the API's limits: five years,
 * and at most 60 month buckets.
 */
export function clampRange(range: DateRange): DateRange {
  const ordered =
    range.from <= range.to ? range : { from: range.to, to: range.from };
  let from = ordered.from;
  if (spanDays(ordered) > MAX_RANGE_DAYS) {
    from = toCycleDateString(addDays(parseISO(ordered.to), 1 - MAX_RANGE_DAYS));
  }
  const firstMonth = monthIndex(ordered.to) - (MAX_MONTH_BUCKETS - 1);
  if (monthIndex(from) < firstMonth) {
    const year = Math.floor(firstMonth / 12);
    const month = String((firstMonth % 12) + 1).padStart(2, "0");
    from = `${year}-${month}-01`;
  }
  return { from, to: ordered.to };
}
