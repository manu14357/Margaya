/** The longest single entry the form accepts: a full day. */
export const MAX_LOGGED_SECONDS = 24 * 60 * 60;

/**
 * Reads a typed duration as seconds: "1h 30m", "2h", "45m", "1.5h", "1:30"
 * or a bare number of minutes ("90"). Null when it isn't one, or it is not
 * between one minute and a day.
 */
export function parseDurationInput(input: string): number | null {
  const text = input.trim().toLowerCase().replace(",", ".");
  if (!text) return null;

  let minutes: number | null = null;
  const clock = /^(\d+):([0-5]\d)$/.exec(text);
  const units = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  } else if (/^\d+$/.test(text)) {
    minutes = Number(text);
  } else if (units && (units[1] || units[2])) {
    minutes = Number(units[1] ?? 0) * 60 + Number(units[2] ?? 0);
  }

  if (minutes === null || !Number.isFinite(minutes)) return null;
  const seconds = Math.round(minutes * 60);
  if (seconds < 60 || seconds > MAX_LOGGED_SECONDS) return null;
  return seconds;
}

/** Whole hours and the remaining minutes of a number of seconds. */
export function splitDuration(seconds: number) {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

type TimeEntryLike = { duration: number | null };

/** Seconds logged across finished entries (a running one has no duration). */
export function totalLoggedSeconds(entries: readonly TimeEntryLike[]) {
  return entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0);
}
