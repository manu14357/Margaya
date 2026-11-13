import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import db from "../../database";
import {
  notificationTable,
  pageTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { deliverNotification } from "../../notification-preferences/delivery";

import { safeOutboundError } from "../../utils/outbound-request";
import { notificationCreatedPayload } from "../load-quiet-decision";
import { preferenceKeyForType } from "../recipient-policy";
import { canReceiveResourceNotification } from "../resource-access";

/**
 * The workspace a notification belongs to, from its resource on the
 * server: a task's project's workspace, a workspace itself, otherwise
 * null. Never read from client-supplied event data.
 */
export async function deriveNotificationWorkspaceId(
  resourceId: string | null | undefined,
  resourceType: string | null | undefined,
): Promise<string | null> {
  if (!resourceId) return null;
  if (resourceType === "task") {
    const [row] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(eq(taskTable.id, resourceId))
      .limit(1);
    return row?.workspaceId ?? null;
  }
  if (resourceType === "workspace") {
    const [row] = await db
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, resourceId))
      .limit(1);
    return row?.id ?? null;
  }
  if (resourceType === "project") {
    const [row] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(eq(projectTable.id, resourceId))
      .limit(1);
    return row?.workspaceId ?? null;
  }
  if (resourceType === "page") {
    const [row] = await db
      .select({ workspaceId: pageTable.workspaceId })
      .from(pageTable)
      .where(eq(pageTable.id, resourceId))
      .limit(1);
    return row?.workspaceId ?? null;
  }
  return null;
}

// One notification for one user. Task events go through notifyTaskEvent
// (recipients.ts); this stays for workspace, integration and reminder rows.
async function createNotification({
  userId,
  title,
  content,
  type,
  eventData,
  resourceId,
  resourceType,
  actorId,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
  actorId?: string | null;
}) {
  if (
    !(await canReceiveResourceNotification(userId, resourceId, resourceType))
  ) {
    return null;
  }

  const preferenceKey = preferenceKeyForType(type);

  if (preferenceKey) {
    const preference = await db.query.userNotificationPreferenceTable.findFirst(
      {
        where: (table, { eq }) => eq(table.userId, userId),
      },
    );

    if (preference?.[preferenceKey] === false) {
      return null;
    }
  }

  const [notification] = await db
    .insert(notificationTable)
    .values({
      id: createId(),
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: eventData ?? null,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
      workspaceId: await deriveNotificationWorkspaceId(
        resourceId,
        resourceType,
      ),
      actorId: actorId || null,
    })
    .returning();

  if (notification) {
    await publishEvent(
      "notification.created",
      await notificationCreatedPayload(notification),
    );
    void deliverNotification(notification.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: notification.id,
        error: safeOutboundError(error),
      });
    });
  }

  return notification;
}

export default createNotification;
