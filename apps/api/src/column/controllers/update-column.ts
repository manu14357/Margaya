import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type ColumnGroup,
  isCompletedGroup,
  resolveColumnGroupForUpdate,
  TRIAGE_MANAGED_MESSAGE,
} from "../groups";

type ColumnUpdate = {
  name?: string;
  icon?: string | null;
  color?: string | null;
  group?: ColumnGroup;
  isFinal?: boolean;
};

async function updateColumn(id: string, data: ColumnUpdate, userId: string) {
  const existing = await db.query.columnTable.findFirst({
    where: eq(columnTable.id, id),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Column not found" });
  }

  if (existing.group === "triage") {
    throw new HTTPException(400, { message: TRIAGE_MANAGED_MESSAGE });
  }

  const { group, isFinal } = resolveColumnGroupForUpdate(existing.group, {
    group: data.group,
    isFinal: data.isFinal,
  });

  const changes: Partial<
    Pick<
      typeof columnTable.$inferInsert,
      "name" | "icon" | "color" | "group" | "isFinal"
    >
  > = {};
  if (data.name !== undefined) changes.name = data.name;
  if (data.icon !== undefined) changes.icon = data.icon;
  if (data.color !== undefined) changes.color = data.color;
  if (group !== existing.group) changes.group = group;
  if (isFinal !== existing.isFinal) changes.isFinal = isFinal;

  const changed = (Object.keys(changes) as (keyof typeof changes)[]).filter(
    (key) => changes[key] !== existing[key],
  );

  const wasCompleted = isCompletedGroup(existing.group);
  const isCompleted = isCompletedGroup(group);

  const updated = await db.transaction(async (tx) => {
    const [row] =
      Object.keys(changes).length > 0
        ? await tx
            .update(columnTable)
            .set(changes)
            .where(eq(columnTable.id, id))
            .returning()
        : [existing];

    // A group change re-stamps the completion of every task in the column in
    // the same transaction, so completedAt never disagrees with the group.
    if (isCompleted && !wasCompleted) {
      await tx
        .update(taskTable)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(taskTable.projectId, existing.projectId),
            eq(taskTable.status, existing.slug),
            isNull(taskTable.completedAt),
          ),
        );
    } else if (wasCompleted && !isCompleted) {
      await tx
        .update(taskTable)
        .set({ completedAt: null })
        .where(
          and(
            eq(taskTable.projectId, existing.projectId),
            eq(taskTable.status, existing.slug),
            isNotNull(taskTable.completedAt),
          ),
        );
    }

    return row;
  });

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to update column" });
  }

  if (changed.length > 0) {
    await publishEvent("column.updated", {
      projectId: existing.projectId,
      columnId: id,
      userId,
      changed,
    });
  }

  return updated;
}

export default updateColumn;
