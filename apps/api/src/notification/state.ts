import { HTTPException } from "hono/http-exception";

// Notification inbox state transitions (B10 §3.8). Views are mutually
// exclusive: archiving clears a snooze and snoozing clears an archive. Read
// or unread is independent of the view.

export const SNOOZE_MIN_MS = 60 * 1000;
export const SNOOZE_MAX_MS = 366 * 24 * 60 * 60 * 1000;

export const SNOOZE_TOO_SOON = "Pick a time in the future";
export const SNOOZE_TOO_LATE = "You can snooze a notification for up to a year";

/** A snooze must end at least a minute and at most a year ahead. */
export function assertSnoozeWindow(until: Date, now: Date): void {
  const delta = until.getTime() - now.getTime();
  if (Number.isNaN(delta) || delta < SNOOZE_MIN_MS) {
    throw new HTTPException(400, { message: SNOOZE_TOO_SOON });
  }
  if (delta > SNOOZE_MAX_MS) {
    throw new HTTPException(400, { message: SNOOZE_TOO_LATE });
  }
}

export type NotificationStateAction =
  | { action: "read" }
  | { action: "unread" }
  | { action: "archive" }
  | { action: "unarchive" }
  | { action: "snooze"; until: Date }
  | { action: "unsnooze" };

export type NotificationStateRow = {
  isRead: boolean | null;
  archivedAt: Date | null;
  snoozedUntil: Date | null;
};

export type NotificationStatePatch = Partial<{
  isRead: boolean;
  archivedAt: Date | null;
  snoozedUntil: Date | null;
  resurfacedAt: Date;
}>;

/** The columns an action writes, or null when it changes nothing. */
export function notificationStatePatch(
  row: NotificationStateRow,
  change: NotificationStateAction,
  now: Date,
): NotificationStatePatch | null {
  switch (change.action) {
    case "read":
      return row.isRead === true ? null : { isRead: true };
    case "unread":
      return row.isRead === true ? { isRead: false } : null;
    case "archive":
      return row.archivedAt ? null : { archivedAt: now, snoozedUntil: null };
    case "unarchive":
      return row.archivedAt ? { archivedAt: null } : null;
    case "snooze":
      return { snoozedUntil: change.until, archivedAt: null };
    case "unsnooze":
      return row.snoozedUntil
        ? { snoozedUntil: null, resurfacedAt: now }
        : null;
  }
}
