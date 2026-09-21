import type Task from "@/types/task";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";

// Task query rows carry no description, so they become board-shaped tasks
// with `descriptionDeferred` set: the full task update keeps the stored
// description instead of clearing it.

export function rowToTask(row: TaskQueryRow, meta?: TaskQueryMeta): Task {
  const assigneeIds = row.assigneeIds ?? (row.userId ? [row.userId] : []);
  const users = meta?.users ?? [];
  const assignees = assigneeIds.flatMap((id) => {
    const user = users.find((candidate) => candidate.id === id);
    return user ? [{ id: user.id, name: user.name, image: user.image }] : [];
  });
  const first = assignees[0];
  return {
    id: row.id,
    title: row.title,
    number: row.number,
    description: null,
    descriptionDeferred: true,
    status: row.status,
    priority: row.priority,
    startDate: row.startDate,
    dueDate: row.dueDate,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userId: row.userId,
    assigneeId: row.userId,
    assigneeName: first?.name ?? null,
    assigneeImage: first?.image ?? null,
    assigneeIds,
    ...(assignees.length === assigneeIds.length ? { assignees } : {}),
    projectId: row.projectId,
    columnId: row.columnId,
    cycleId: row.cycleId ?? null,
    estimatePointId: row.estimatePointId ?? null,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    labels: (row.labels ?? []).map((label) => ({
      id: `name:${label.name}`,
      name: label.name,
      color: label.color,
    })),
    externalLinks: row.externalLinks ?? [],
    customFieldValues: row.customFieldValues ?? [],
  };
}

/** The meta column of a row's status, if any. */
export function columnOfRow(row: TaskQueryRow, meta: TaskQueryMeta) {
  return meta.columns.find(
    (column) =>
      column.projectId === row.projectId && column.slug === row.status,
  );
}

/** Completed-group rows don't show overdue due dates. */
export function isRowCompleted(row: TaskQueryRow): boolean {
  return row.group === "completed" || row.group === "cancelled";
}
