import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import { formatTaskKey } from "../task-activity/task-snapshot";
import type { TaskCardData } from "./board";

// Task cards drawn from live task data, for previews and public links. Only
// tasks of the board's own project (and not in the trash) are resolved, so
// a card can never reveal a task from elsewhere. Public links show only the
// key, title and status (what the share dialog promises): no assignee, due
// date or priority.

export async function loadTaskCards(
  projectId: string,
  taskIds: readonly string[],
  options: { publicView?: boolean } = {},
): Promise<Record<string, TaskCardData>> {
  const publicView = options.publicView === true;
  const unique = [...new Set(taskIds)];
  const cards: Record<string, TaskCardData> = {};
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500);
    const rows = await db
      .select({
        id: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
        priority: taskTable.priority,
        dueDate: taskTable.dueDate,
        completedAt: taskTable.completedAt,
        slug: projectTable.slug,
        columnName: columnTable.name,
        columnColor: columnTable.color,
        columnFinal: columnTable.isFinal,
        assigneeName: userTable.name,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, eq(columnTable.id, taskTable.columnId))
      .leftJoin(userTable, eq(userTable.id, taskTable.userId))
      .where(
        and(
          inArray(taskTable.id, chunk),
          eq(taskTable.projectId, projectId),
          isNull(taskTable.deletedAt),
        ),
      );
    for (const row of rows) {
      cards[row.id] = {
        key: formatTaskKey(row.slug, row.number),
        title: row.title,
        statusName: row.columnName ?? row.status,
        statusColor: row.columnColor ?? null,
        assigneeName: publicView ? null : (row.assigneeName ?? null),
        dueDate: publicView || !row.dueDate ? null : row.dueDate.toISOString(),
        priority: publicView ? null : (row.priority ?? null),
        done: Boolean(row.columnFinal) || row.completedAt !== null,
      };
    }
  }
  return cards;
}
