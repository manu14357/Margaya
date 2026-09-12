import { HTTPException } from "hono/http-exception";
import {
  addDays,
  addMonths,
  isValidDay,
  startOfMonth,
  startOfWeek,
  type WeekStart,
} from "../task-query/dates";
import { daySpan } from "../utils/calendar-date";

// Calendar buckets for date dimensions and series (B8 §2A.4, §2A.6). Keys
// are the bucket's first local day, "YYYY-MM-DD", so they sort
// chronologically as strings. Pure: no database, no clock.

export const DATE_BUCKETS = ["week", "month"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

/** Longest range a series may cover: to − from in days (five years). */
export const MAX_RANGE_DAYS = 1830;
export const MAX_WEEK_BUCKETS = 106;
export const MAX_MONTH_BUCKETS = 60;

export const INVALID_DATE = "Invalid date";
export const INVALID_DATE_RANGE = "Invalid date range";
export const TOO_MANY_BUCKETS =
  "Too many buckets; choose months or a shorter range";

/** The first day of the bucket containing `day`. */
export function bucketStart(
  day: string,
  bucket: DateBucket,
  weekStartsOn: WeekStart,
): string {
  return bucket === "month"
    ? startOfMonth(day)
    : startOfWeek(day, weekStartsOn);
}

/** The first day of the bucket after the one starting on `start`. */
export function nextBucket(start: string, bucket: DateBucket): string {
  return bucket === "month" ? addMonths(start, 1) : addDays(start, 7);
}

/** The last day (inclusive) of the bucket starting on `start`. */
export function bucketEnd(start: string, bucket: DateBucket): string {
  return addDays(nextBucket(start, bucket), -1);
}

function monthIndex(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
}

/** How many buckets run from the one starting `first` to the one starting `last`. */
export function bucketCount(
  first: string,
  last: string,
  bucket: DateBucket,
): number {
  if (last < first) return 0;
  return bucket === "month"
    ? monthIndex(last) - monthIndex(first) + 1
    : Math.round(daySpan(first, last) / 7) + 1;
}

/** A series point's bucket: its key plus the part of it inside the range. */
export type BucketWindow = {
  start: string;
  rangeStart: string;
  rangeEnd: string;
};

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

/**
 * The buckets of a series from `from` to `to` (inclusive local days), each
 * clipped to the range, so the first and last can be partial. Throws the
 * §3.5 400s: an impossible date, from after to, more than five years, or
 * more than 106 weeks or 60 months.
 */
export function rangeBuckets(
  from: string,
  to: string,
  bucket: DateBucket,
  weekStartsOn: WeekStart,
): BucketWindow[] {
  if (!isValidDay(from) || !isValidDay(to)) badRequest(INVALID_DATE);
  if (from > to) badRequest(INVALID_DATE_RANGE);
  if (daySpan(from, to) > MAX_RANGE_DAYS) badRequest(TOO_MANY_BUCKETS);
  const first = bucketStart(from, bucket, weekStartsOn);
  const last = bucketStart(to, bucket, weekStartsOn);
  const limit = bucket === "month" ? MAX_MONTH_BUCKETS : MAX_WEEK_BUCKETS;
  if (bucketCount(first, last, bucket) > limit) badRequest(TOO_MANY_BUCKETS);

  const windows: BucketWindow[] = [];
  for (let start = first; start <= last; start = nextBucket(start, bucket)) {
    const end = bucketEnd(start, bucket);
    windows.push({
      start,
      rangeStart: start < from ? from : start,
      rangeEnd: end > to ? to : end,
    });
  }
  return windows;
}

/**
 * Every bucket key from the earliest to the latest of `keys` (a time axis
 * without gaps), keeping only the most recent `cap`. `hidden` counts the
 * older buckets left out; nothing older than the kept ones is generated, so
 * a huge span stays cheap.
 */
export function fillDateKeys(
  keys: readonly string[],
  bucket: DateBucket,
  cap: number,
): { keys: string[]; hidden: number } {
  if (keys.length === 0) return { keys: [], hidden: 0 };
  const sortedKeys = [...keys].sort();
  const first = sortedKeys[0] as string;
  const last = sortedKeys[sortedKeys.length - 1] as string;
  const total = bucketCount(first, last, bucket);
  const kept = Math.min(total, cap);

  const filled: string[] = [];
  let start = last;
  for (let index = 0; index < kept; index++) {
    filled.push(start);
    start = bucket === "month" ? addMonths(start, -1) : addDays(start, -7);
  }
  return { keys: filled.reverse(), hidden: total - kept };
}
