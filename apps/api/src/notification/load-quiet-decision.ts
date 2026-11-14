import { eq, inArray } from "drizzle-orm";
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
type PayloadRow = {
  id: string;
  userId: string;
  type: string;
  eventData: unknown;
  resourceId: string | null;
  resourceType: string | null;
};

/**
 * `user` skips the user lookup: pass the recipient's settings when the
 * caller has them, or null for a recipient that no longer exists.
 */
export async function notificationCreatedPayload(
  row: PayloadRow,
  user?: QuietUser | null,
): Promise<NotificationCreatedEvent> {
  const decision =
    user === null
      ? NOT_QUIET
      : await loadQuietDecision(row, user ? { user } : {}).catch((error) => {
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

/**
 * The payloads for a batch of new notifications, reading every recipient's
 * quiet-time settings in one query, so a fan-out to 30 people costs the
 * same statements as one to 2.
 */
export async function notificationCreatedPayloads(
  rows: readonly PayloadRow[],
): Promise<NotificationCreatedEvent[]> {
  const userIds = [...new Set(rows.map((row) => row.userId))];
  let users: Map<string, QuietUser>;
  try {
    const found =
      userIds.length === 0
        ? []
        : await db
            .select({
              id: userTable.id,
              preferences: userTable.preferences,
              timezone: userTable.timezone,
            })
            .from(userTable)
            .where(inArray(userTable.id, userIds));
    users = new Map(found.map(({ id, ...user }) => [id, user]));
  } catch (error) {
    console.error("Quiet-time check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    users = new Map();
  }
  return Promise.all(
    rows.map((row) =>
      notificationCreatedPayload(row, users.get(row.userId) ?? null),
    ),
  );
}
