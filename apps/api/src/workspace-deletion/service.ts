import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  findBillableWorkspaces,
  formatBillableWorkspacesMessage,
} from "../billing/controllers/find-billable-workspaces";
import db from "../database";
import { userTable, workspaceTable } from "../database/schema";
import { publishEvent } from "../events";
import { recordInstanceAudit } from "../instance-admin/audit";
import { deletionDueAt, workspaceDeletionGraceDays } from "./settings";
import "./notify";

// Delayed workspace deletion: the owner schedules it, the workspace turns
// read-only for the grace period (lock.ts), the owner may cancel, and the
// purge job deletes it once it is due (purge-job.ts).

export const WORKSPACE_NOT_FOUND = "Workspace not found";

export async function getWorkspaceDeletion(workspaceId: string) {
  const [row] = await db
    .select({
      scheduledAt: workspaceTable.deletionScheduledAt,
      dueAt: workspaceTable.deletionDueAt,
      scheduledById: workspaceTable.deletionScheduledById,
      scheduledByName: userTable.name,
    })
    .from(workspaceTable)
    .leftJoin(userTable, eq(userTable.id, workspaceTable.deletionScheduledById))
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: WORKSPACE_NOT_FOUND });
  const pending = row.dueAt !== null;
  return {
    pending,
    scheduledAt: pending ? row.scheduledAt : null,
    dueAt: row.dueAt,
    scheduledBy:
      pending && row.scheduledById
        ? { id: row.scheduledById, name: row.scheduledByName ?? "" }
        : null,
    graceDays: workspaceDeletionGraceDays(),
  };
}

/** Schedules the deletion; scheduling it again changes nothing. */
export async function scheduleWorkspaceDeletion({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  // Same rule as an immediate delete: a paid subscription must end first.
  const billable = await findBillableWorkspaces([workspaceId]);
  if (billable.length > 0) {
    throw new HTTPException(409, {
      message: formatBillableWorkspacesMessage(
        billable.map((workspace) => workspace.name),
      ),
    });
  }

  const now = new Date();
  const [scheduled] = await db
    .update(workspaceTable)
    .set({
      deletionScheduledAt: now,
      deletionDueAt: deletionDueAt(now),
      deletionScheduledById: userId,
    })
    .where(
      and(
        eq(workspaceTable.id, workspaceId),
        isNull(workspaceTable.deletionDueAt),
      ),
    )
    .returning({
      name: workspaceTable.name,
      dueAt: workspaceTable.deletionDueAt,
    });

  if (scheduled) {
    const dueAt = scheduled.dueAt?.toISOString() ?? null;
    await publishEvent("workspace.deletion_scheduled", {
      workspaceId,
      workspaceName: scheduled.name,
      userId,
      dueAt,
    });
    await recordInstanceAudit({
      action: "workspace.deletion_scheduled",
      target: { type: "workspace", id: workspaceId, label: scheduled.name },
      metadata: { dueAt },
      actor: { userId },
    });
  }
  return getWorkspaceDeletion(workspaceId);
}

/** Cancels a pending deletion; without one it changes nothing. */
export async function cancelWorkspaceDeletion({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  const [cancelled] = await db
    .update(workspaceTable)
    .set({
      deletionScheduledAt: null,
      deletionDueAt: null,
      deletionScheduledById: null,
    })
    .where(
      and(
        eq(workspaceTable.id, workspaceId),
        isNotNull(workspaceTable.deletionDueAt),
      ),
    )
    .returning({ name: workspaceTable.name });

  if (cancelled) {
    await publishEvent("workspace.deletion_cancelled", {
      workspaceId,
      workspaceName: cancelled.name,
      userId,
    });
    await recordInstanceAudit({
      action: "workspace.deletion_cancelled",
      target: { type: "workspace", id: workspaceId, label: cancelled.name },
      actor: { userId },
    });
  }
  return getWorkspaceDeletion(workspaceId);
}

/** Whether the workspace's grace period is over (Better Auth's delete). */
export async function isWorkspaceDeletionDue(
  workspaceId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ dueAt: workspaceTable.deletionDueAt })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return Boolean(row?.dueAt && row.dueAt <= now);
}
