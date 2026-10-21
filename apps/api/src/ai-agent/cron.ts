import { Cron } from "croner";
import { isValidTimezone } from "../utils/zoned-date";

// Agent schedules: five-field cron expressions (minute hour day month
// weekday) evaluated in an IANA time zone, with croner (already used by the
// scheduler). Each schedule runs at most every 15 minutes: an agent run
// costs money, and a tighter loop is a mistake far more often than a need.

export const MIN_SCHEDULE_INTERVAL_MS = 15 * 60 * 1000;
// Enough upcoming runs to see the shortest gap of any realistic pattern
// (a "*/5" minute field shows it within the first two).
const GAP_SAMPLES = 12;

export type CronProblem =
  | "CRON_INVALID"
  | "CRON_TOO_FREQUENT"
  | "CRON_NEVER"
  | "TIMEZONE_INVALID";

export class CronError extends Error {
  constructor(readonly code: CronProblem) {
    super(code);
    this.name = "CronError";
  }
}

function pattern(expression: string, timezone: string): Cron {
  const fields = expression.trim().split(/\s+/);
  // Five fields only: croner also takes seconds and years, which a
  // schedule never needs and the editor never shows.
  if (fields.length !== 5) throw new CronError("CRON_INVALID");
  if (!isValidTimezone(timezone)) throw new CronError("TIMEZONE_INVALID");
  try {
    return new Cron(fields.join(" "), { timezone, paused: true });
  } catch {
    throw new CronError("CRON_INVALID");
  }
}

/** The next run strictly after `after`, or null when there is none. */
export function nextRunAfter(
  expression: string,
  timezone: string,
  after: Date,
): Date | null {
  try {
    return pattern(expression, timezone).nextRun(after) ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks a schedule and returns its normalized expression and next run;
 * throws a CronError with a stable code.
 */
export function validateSchedule(
  expression: string,
  timezone: string,
  now: Date = new Date(),
): { cron: string; nextRunAt: Date } {
  const cron = pattern(expression, timezone);
  const runs = cron.nextRuns(GAP_SAMPLES, now);
  const [first] = runs;
  if (!first) throw new CronError("CRON_NEVER");
  for (let index = 1; index < runs.length; index++) {
    const gap =
      (runs[index] as Date).getTime() - (runs[index - 1] as Date).getTime();
    if (gap < MIN_SCHEDULE_INTERVAL_MS) {
      throw new CronError("CRON_TOO_FREQUENT");
    }
  }
  return { cron: expression.trim().split(/\s+/).join(" "), nextRunAt: first };
}
