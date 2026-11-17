import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireWorkspaceEntitlement } from "../billing/controllers/require-entitlement";
import db from "../database";
import {
  columnTable,
  notificationTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { taskGroupOf } from "../task/scope";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

// The buttons Margaya Desktop may put on a native alert. The app performs
// them through the ordinary routes (snooze: PATCH /notification/{id}/snooze;
// done: PUT /task/status/{id} with the project's first completed column;
// reply: opens the task with its comment box focused), so this only says
// which ones would succeed; the routes stay the authority.

export const DESKTOP_ACTIONS = ["done", "snooze", "reply"] as const;
export type DesktopAction = (typeof DESKTOP_ACTIONS)[number];

/** Notification kinds about one task that a person can act on from an alert. */
const TASK_ACTION_KINDS = new Set([
  "task_created",
  "task_status_changed",
  "task_assignee_changed",
  "task_mention",
  "task_comment",
  "task_updated",
  "due_date_reminder",
  "task_overdue",
]);

export function isTaskActionKind(
  type: string | null | undefined,
  resourceType: string | null | undefined,
) {
  return resourceType === "task" && TASK_ACTION_KINDS.has(type ?? "");
}

/** Groups a task can't be marked done from: already closed, or in intake. */
const NOT_DONEABLE = new Set(["completed", "cancelled", "triage"]);

/**
 * Which actions apply. None for credentials that can't change anything (a
 * read-only API key). Snooze changes only the caller's own inbox row.
 * Replying and marking done take task:update, as the comment and status
 * routes do; done also needs an open task (not archived, not closed, not
 * waiting in intake) in a project with a completed column.
 */
export function pickDesktopActions(input: {
  /** The request's credentials may write (false for a read-only API key). */
  canWrite: boolean;
  canUpdate: boolean;
  /** The workspace may edit (billing); the status route checks it, comments don't. */
  entitled: boolean;
  archived: boolean;
  group: string;
  hasDoneColumn: boolean;
}): DesktopAction[] {
  const actions: DesktopAction[] = [];
  if (
    input.canUpdate &&
    input.entitled &&
    !input.archived &&
    input.hasDoneColumn &&
    !NOT_DONEABLE.has(input.group)
  ) {
    actions.push("done");
  }
  actions.push("snooze");
  if (input.canUpdate) actions.push("reply");
  return input.canWrite ? actions : [];
}

const NONE = { taskId: null, actions: [] as DesktopAction[] };

/**
 * The task a desktop alert is about and the actions its buttons may offer.
 * Call only after the notification was found to be the caller's and its
 * task visible to them (buildDesktopNotification). Runs the task routes'
 * own checks: workspace access (API key project scope, workspace deletion
 * lock), then the permission check with the request's workspace and
 * project set (role, restricted-project role, API key scope).
 */
export async function desktopNotificationActions(
  c: Context,
  notificationId: string,
  userId: string,
): Promise<{ taskId: string | null; actions: DesktopAction[] }> {
  const [notification] = await db
    .select({
      type: notificationTable.type,
      resourceId: notificationTable.resourceId,
      resourceType: notificationTable.resourceType,
    })
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.id, notificationId),
        eq(notificationTable.userId, userId),
      ),
    )
    .limit(1);
  if (
    !notification?.resourceId ||
    !isTaskActionKind(notification.type, notification.resourceType)
  ) {
    return NONE;
  }

  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
      status: taskTable.status,
      archivedAt: taskTable.archivedAt,
      deletedAt: taskTable.deletedAt,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, notification.resourceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!task || task.deletedAt) return NONE;

  // What workspaceAccess.fromTask() checks before the task routes' permission
  // check; a refusal there means no task and no buttons.
  try {
    await validateWorkspaceAccess(
      userId,
      task.workspaceId,
      c.get("apiKey")?.id,
      task.projectId,
    );
  } catch (error) {
    if (error instanceof HTTPException) return NONE;
    throw error;
  }

  c.set("workspaceId", task.workspaceId);
  c.set("projectId", task.projectId);
  const canUpdate = await hasWorkspacePermission(c, { task: ["update"] });
  const entitled = await requireWorkspaceEntitlement(task.workspaceId).then(
    () => true,
    (error) => {
      if (error instanceof HTTPException) return false;
      throw error;
    },
  );

  const columns = await db
    .select({ slug: columnTable.slug, group: columnTable.group })
    .from(columnTable)
    .where(eq(columnTable.projectId, task.projectId));
  const current = columns.find((column) => column.slug === task.status);

  return {
    taskId: task.id,
    actions: pickDesktopActions({
      // Every action is a PATCH, PUT or POST, which a read-only key may not
      // send (readOnlyKeyAllows in api-key/scope.ts).
      canWrite: c.get("apiKey")?.readOnly !== true,
      canUpdate,
      entitled,
      archived: task.archivedAt !== null,
      group: taskGroupOf(task.status, current ?? null),
      hasDoneColumn: columns.some((column) => column.group === "completed"),
    }),
  };
}
