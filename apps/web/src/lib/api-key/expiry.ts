const DAY_SECONDS = 24 * 60 * 60;
// Better Auth's default keyExpiration bounds, in days.
export const MIN_KEY_EXPIRY_DAYS = 1;
export const MAX_KEY_EXPIRY_DAYS = 365;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The first and last local days a custom expiry may end on. */
export function customExpiryBounds(now = new Date()) {
  const today = startOfDay(now);
  return {
    first: addDays(today, MIN_KEY_EXPIRY_DAYS),
    last: addDays(today, MAX_KEY_EXPIRY_DAYS),
  };
}

export function isCustomExpiryAllowed(day: Date, now = new Date()): boolean {
  const { first, last } = customExpiryBounds(now);
  const value = startOfDay(day).getTime();
  return value >= first.getTime() && value <= last.getTime();
}

// Better Auth adds `expiresIn` to its own clock when the request arrives, so
// request latency (and client clock skew) shifts the expiry later. Ending the
// key this long before midnight keeps it on the chosen day.
export const EXPIRY_SAFETY_MARGIN_SECONDS = 5 * 60;

/**
 * `expiresIn` (seconds) for a key that expires on `day`, local time: at the
 * end of that day minus a safety margin. The last allowed day can end
 * slightly more than 365 days from now, so the value is capped at the
 * server's maximum.
 */
export function customExpiresInSeconds(day: Date, now = new Date()): number {
  const endOfDay = addDays(startOfDay(day), 1).getTime();
  const target = endOfDay - EXPIRY_SAFETY_MARGIN_SECONDS * 1000;
  const seconds = Math.floor((target - now.getTime()) / 1000);
  return Math.min(
    Math.max(seconds, MIN_KEY_EXPIRY_DAYS * DAY_SECONDS),
    MAX_KEY_EXPIRY_DAYS * DAY_SECONDS,
  );
}
