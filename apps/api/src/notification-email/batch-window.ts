// How long email notifications wait to be grouped into one email. 0 sends
// each one immediately, as before batching existed.
export const DEFAULT_EMAIL_BATCH_WINDOW_SECONDS = 300;
const MAX_EMAIL_BATCH_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS as whole seconds: unset or not a
 * number gives the default, negatives give 0, and it is capped at a day.
 */
export function parseEmailBatchWindowSeconds(
  raw: string | undefined | null,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_EMAIL_BATCH_WINDOW_SECONDS;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return DEFAULT_EMAIL_BATCH_WINDOW_SECONDS;
  return Math.min(
    Math.max(0, Math.floor(value)),
    MAX_EMAIL_BATCH_WINDOW_SECONDS,
  );
}

/** Read on every call, so tests and restarts pick up changes. */
export function getEmailBatchWindowSeconds(): number {
  return parseEmailBatchWindowSeconds(
    process.env.EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS,
  );
}

/**
 * Queued rows created at or before this instant are due. A user's batch is
 * sent once their oldest queued row is due, taking every queued row with it.
 */
export function batchDueBefore(now: Date, windowSeconds: number): Date {
  return new Date(now.getTime() - windowSeconds * 1000);
}
