import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  completedAtAssignment,
  entryColumn,
  PLANNED_STATUS,
  type TaskGroup,
} from "../../task/scope";
import { TRIAGE_MANAGED_MESSAGE } from "../groups";

async function deleteColumn(id: string, userId: string) {
  const existing = await db.query.columnTable.findFirst({
    where: eq(columnTable.id, id),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Column not found" });
  }

  if (existing.group === "triage") {
    throw new HTTPException(400, { message: TRIAGE_MANAGED_MESSAGE });
  }

  await db.transaction(async (tx) => {
    const [liveCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(taskTable)
      // Trashed tasks never block it (C7): a restore falls back to the
      // project's entry column when their column is gone.
      .where(
        and(
          eq(taskTable.columnId, id),
          isNull(taskTable.archivedAt),
          isNull(taskTable.deletedAt),
        ),
      );

    if (liveCount && liveCount.count > 0) {
      throw new HTTPException(409, {
        message:
          "Cannot delete column that contains tasks. Move or delete tasks first.",
      });
    }

    // Archived tasks keep their column (D7) but never block deleting it, as
    // before D7. They move to where a restore can land, so their status never
    // names a column that no longer exists: the first other column in the
    // same group, else the entry column, else planned. Clients refetch tasks
    // on column.deleted; no per-task event, so integrations and
    // notifications stay quiet about a housekeeping move.
    const others = await tx
      .select({
        id: columnTable.id,
        slug: columnTable.slug,
        position: columnTable.position,
        group: columnTable.group,
      })
      .from(columnTable)
      .where(
        and(
          eq(columnTable.projectId, existing.projectId),
          ne(columnTable.id, id),
          ne(columnTable.group, "triage"),
        ),
      );
    const target =
      [...others]
        .sort((a, b) => a.position - b.position)
        .find((column) => column.group === existing.group) ??
      entryColumn(others);
    const group: TaskGroup = target?.group ?? "backlog";

    await tx
      .update(taskTable)
      .set({
        status: target?.slug ?? PLANNED_STATUS,
        columnId: target?.id ?? null,
        completedAt: completedAtAssignment(group, new Date()),
      })
      .where(
        and(
          isNotNull(taskTable.archivedAt),
          or(
            eq(taskTable.columnId, id),
            and(
              eq(taskTable.projectId, existing.projectId),
              eq(taskTable.status, existing.slug),
            ),
          ),
        ),
      );

    await tx.delete(columnTable).where(eq(columnTable.id, id));
  });

  await publishEvent("column.deleted", {
    projectId: existing.projectId,
    columnId: id,
    userId,
  });

  return existing;
}

export default deleteColumn;
