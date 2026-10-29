import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import {
  isDirectKind,
  preferenceKeyForType,
  TASK_EVENT_POLICY,
  type TaskEventKind,
} from "../notification/recipient-policy";
import { notMutedSql } from "../notification/recipients";
import { notificationResourceAccess } from "../notification/resource-access";
import {
  buildRecipientDeliveryContent,
  buildTaskUrl,
} from "../notification-preferences/delivery";
import { visibleTaskCondition } from "../task/scope";
import type { BatchItem } from "./grouping";

// Send-time checks for queued email notifications. Everything that made the
// notification emailable when it was queued is checked again, because the
// batch window gives the user time to mute it, lose access, or the task time
// to be deleted, archived or moved back to triage.

/** Types that reach their targets even on a task the user muted. */
const DIRECT_TYPES = new Set(
  (Object.keys(TASK_EVENT_POLICY) as TaskEventKind[])
    .filter(isDirectKind)
    .map((kind) => TASK_EVENT_POLICY[kind].type),
);

const actorUser = alias(userTable, "email_batch_actor");

export type BatchRecipient = { email: string; locale: string | null };

function stringField(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

async function loadRecipient(userId: string) {
  const [row] = await db
    .select({
      email: userTable.email,
      locale: userTable.locale,
      preference: userNotificationPreferenceTable,
    })
    .from(userTable)
    .leftJoin(
      userNotificationPreferenceTable,
      eq(userNotificationPreferenceTable.userId, userTable.id),
    )
    .where(eq(userTable.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * The queued notifications of `userId` that may still be emailed, as batch
 * items, and where to send them. No recipient means email is off for them.
 */
export async function loadEligibleBatchItems(
  userId: string,
  notificationIds: readonly string[],
): Promise<{ recipient: BatchRecipient | null; items: BatchItem[] }> {
  const user = await loadRecipient(userId);
  const preference = user?.preference;
  if (
    !user?.email ||
    !preference?.emailEnabled ||
    notificationIds.length === 0
  ) {
    return { recipient: null, items: [] };
  }

  const rules = await db.query.userNotificationWorkspaceRuleTable.findMany({
    where: eq(userNotificationWorkspaceRuleTable.userId, userId),
    with: { selectedProjects: true },
  });
  const ruleByWorkspace = new Map(
    rules.map((rule) => [rule.workspaceId, rule]),
  );

  const rows = await db
    .select({
      id: notificationTable.id,
      type: notificationTable.type,
      title: notificationTable.title,
      content: notificationTable.content,
      eventData: notificationTable.eventData,
      createdAt: notificationTable.createdAt,
      resourceType: notificationTable.resourceType,
      accessible: notificationResourceAccess(
        userId,
        notificationTable.resourceId,
        notificationTable.resourceType,
      ),
      taskId: taskTable.id,
      taskTitle: taskTable.title,
      taskVisible: sql<boolean>`(${visibleTaskCondition} and ${isNull(projectTable.deletedAt)})`,
      taskMuted: sql<boolean>`not ${notMutedSql(taskTable.id, sql`${userId}`)}`,
      projectId: projectTable.id,
      projectName: projectTable.name,
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
      actorName: actorUser.name,
    })
    .from(notificationTable)
    .leftJoin(
      taskTable,
      and(
        eq(notificationTable.resourceType, "task"),
        eq(taskTable.id, notificationTable.resourceId),
      ),
    )
    .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(
      workspaceTable,
      eq(
        workspaceTable.id,
        sql`coalesce(${projectTable.workspaceId}, case when ${notificationTable.resourceType} = 'workspace' then ${notificationTable.resourceId} end)`,
      ),
    )
    .leftJoin(actorUser, eq(actorUser.id, notificationTable.actorId))
    .where(
      and(
        eq(notificationTable.userId, userId),
        inArray(notificationTable.id, [...notificationIds]),
      ),
    );

  const items: BatchItem[] = [];
  for (const row of rows) {
    if (!row.accessible || !row.workspaceId || !row.workspaceName) continue;
    const isTask = row.resourceType === "task";
    if (isTask && (!row.taskId || !row.taskVisible || !row.projectId)) continue;
    if (!isTask && row.resourceType !== "workspace") continue;

    const key = preferenceKeyForType(row.type);
    if (key && preference[key] === false) continue;
    if (isTask && row.taskMuted && !DIRECT_TYPES.has(row.type)) continue;

    const rule = ruleByWorkspace.get(row.workspaceId);
    if (!rule?.isActive || !rule.emailEnabled) continue;
    if (
      rule.projectMode === "selected" &&
      !rule.selectedProjects.some(
        (project) => project.projectId === row.projectId,
      )
    ) {
      continue;
    }

    const content = buildRecipientDeliveryContent(
      {
        type: row.type,
        title: row.title ?? null,
        content: row.content ?? null,
        eventData:
          row.eventData && typeof row.eventData === "object"
            ? (row.eventData as Record<string, unknown>)
            : null,
      },
      user.locale,
    );
    items.push({
      notificationId: row.id,
      createdAt: row.createdAt,
      title: content.title,
      body: content.body,
      actorName:
        row.actorName ??
        stringField(row.eventData, "actorName") ??
        stringField(row.eventData, "mentionerName") ??
        stringField(row.eventData, "commenterName"),
      task:
        isTask && row.taskId && row.projectId
          ? {
              id: row.taskId,
              title: row.taskTitle ?? "",
              url: buildTaskUrl(row.workspaceId, row.projectId, row.taskId),
              projectName: row.projectName ?? "",
            }
          : null,
      workspaceName: row.workspaceName,
    });
  }

  return {
    recipient: { email: user.email, locale: user.locale ?? null },
    items,
  };
}
