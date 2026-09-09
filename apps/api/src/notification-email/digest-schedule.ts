import {
  localDateString,
  localDateTimeParts,
  resolveTimezone,
} from "../utils/zoned-date";

// When a user's digest is due. Pure: the job feeds it the user's settings,
// their time zone and when their last digest period was handled.

export const DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const DEFAULT_DIGEST_HOUR = 8;
export const DEFAULT_DIGEST_WEEKDAY = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DigestSchedule = {
  frequency: string;
  /** 0 = Sunday … 6 = Saturday; weekly only. */
  weekday: number;
  /** Local hour, 0–23. */
  hour: number;
  timeZone: string;
  lastSentAt: Date | null;
};

/** The local weekday of `instant` in `timeZone`, 0 = Sunday. */
export function localWeekday(instant: Date, timeZone: string): number {
  const { year, month, day } = localDateTimeParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * True once the local send hour has passed on a day the digest runs, unless
 * this local day was already handled. A missed day is skipped, not caught up.
 */
export function isDigestDue(schedule: DigestSchedule, now: Date): boolean {
  if (schedule.frequency !== "daily" && schedule.frequency !== "weekly") {
    return false;
  }
  const timeZone = resolveTimezone(schedule.timeZone);
  if (localDateTimeParts(now, timeZone).hour < schedule.hour) return false;
  if (
    schedule.frequency === "weekly" &&
    localWeekday(now, timeZone) !== schedule.weekday
  ) {
    return false;
  }
  if (
    schedule.lastSentAt &&
    localDateString(schedule.lastSentAt, timeZone) ===
      localDateString(now, timeZone)
  ) {
    return false;
  }
  return true;
}

/** Where "new since the last digest" starts: the last one, or one period back. */
export function digestSince(
  frequency: "daily" | "weekly",
  lastSentAt: Date | null,
  now: Date,
): Date {
  if (lastSentAt) return lastSentAt;
  return new Date(now.getTime() - (frequency === "weekly" ? 7 : 1) * DAY_MS);
}
