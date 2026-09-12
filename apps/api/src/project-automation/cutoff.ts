import {
  DEFAULT_TIMEZONE,
  localDateTimeParts,
  zonedTimeToUtc,
} from "../utils/zoned-date";

// "Not updated for N months": `task.updatedAt` at or before `now` minus N
// calendar months on the workspace's wall clock (UTC by default). The day is
// clamped to the target month's last day and the time of day is kept (May 31
// minus 3 months is Feb 28).

export function automationCutoff(
  now: Date,
  months: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  const local = localDateTimeParts(now, timezone);
  const target = new Date(0);
  target.setUTCFullYear(local.year, local.month - 1 - months, 1);
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();

  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month + 1, 0);

  return zonedTimeToUtc(
    {
      year,
      month: month + 1,
      day: Math.min(local.day, lastDay.getUTCDate()),
      hour: local.hour,
      minute: local.minute,
      second: local.second,
      millisecond: now.getUTCMilliseconds(),
    },
    timezone,
  );
}

const DAY_MS = 86_400_000;

/**
 * Auto-close skips tasks whose start or due date has not passed by a full
 * day: dates are stored at the author's local midnight, so the grace day
 * absorbs time zones.
 */
export function upcomingDateGrace(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}
