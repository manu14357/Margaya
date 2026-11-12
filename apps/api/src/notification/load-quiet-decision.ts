import { eq } from "drizzle-orm";
import db from "../database";
import { taskTable, userTable } from "../database/schema";
import { cleanPreferences } from "../user/controllers/user-preferences";
import {
  type NotificationCreatedEvent,
  notificationCreatedEvent,
} from "./created-event";
import {
  isQuietNow,
  NOT_QUIET,
  type QuietDecision,
  quietDecision,
  quietSettings,
  validTimeZone,
} from "./quiet";

export type QuietUser = { preferences: unknown; timezone: string | null };

/**
 * The decision for one of a user's notifications now. Reads the user unless
 * the caller already has them; reads the task's priority only when an
 * assignment could bypass as urgent.
 */
export async function loadQuietDecision(
  notification: {
    userId: string;
    type: string;
    eventData: unknown;
    resourceId: string | null;
    resourceType: string | null;
  },
  options: {
    user?: QuietUser;
    now?: Date;
    /** Used when the account has no time zone (Margaya Desktop's device). */
    fallbackTimeZone?: string | null;
  } = {},
): Promise<QuietDecision> {
  const now = options.now ?? new Date();
  let user = options.user;
  if (!user) {
    const [row] = await db
      .select({
        preferences: userTable.preferences,
        timezone: userTable.timezone,
      })
      .from(userTable)
      .where(eq(userTable.id, notification.userId))
      .limit(1);
    if (!row) return NOT_QUIET;
    user = row;
  }
  const settings = quietSettings(cleanPreferences(user.preferences));
  const timeZone =
    validTimeZone(user.timezone) ?? validTimeZone(options.fallbackTimeZone);
  if (!isQuietNow(settings, now, timeZone)) return NOT_QUIET;

  let urgentTask = false;
  if (
    notification.type === "task_assignee_changed" &&
    settings.bypass.includes("urgent") &&
    notification.resourceType === "task" &&
    notification.resourceId
  ) {
    const [task] = await db
      .select({ priority: taskTable.priority })
      .from(taskTable)
      .where(eq(taskTable.id, notification.resourceId))
      .limit(1);
    urgentTask = task?.priority === "urgent";
  }
  return quietDecision({
    settings,
    notification,
    urgentTask,
    now,
    timeZone,
  });
}

/**
 * The notification.created payload plus the quiet-time flags, so the user
 * socket can keep the web app silent and Margaya Desktop from alerting. A
 * failed lookup never blocks the hint: it goes out as not quiet.
 */
export async function notificationCreatedPayload(row: {
  id: string;
  userId: string;
  type: string;
  eventData: unknown;
  resourceId: string | null;
  resourceType: string | null;
}): Promise<NotificationCreatedEvent> {
  const decision = await loadQuietDecision(row).catch((error) => {
    console.error("Quiet-time check failed", {
      notificationId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NOT_QUIET;
  });
  return {
    ...notificationCreatedEvent(row),
    quiet: decision.quiet,
    desktopHeld: decision.held.has("desktop"),
  };
}
