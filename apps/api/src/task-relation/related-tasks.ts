import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import {
  hiddenForCurrentRequest,
  notHiddenProject,
} from "../project/visibility";
import { assigneesOfTasks } from "../task/assignees";
import {
  liveTaskCondition,
  type TaskGroup,
  taskColumnJoin,
  taskGroupSql,
} from "../task/scope";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

export type RelatedTask = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  number: number | null;
  projectId: string;
  projectSlug: string;
  projectName: string;
  group: TaskGroup | null;
  userId: string | null;
  assigneeName: string | null;
  assigneeIds: string[];
};

/**
 * Summaries of the tasks that belong to the workspace; ids of other
 * workspaces (legacy rows), trashed and missing ids are left out. One task query plus
 * one assignee query.
 */
export async function loadRelatedTasks(
  taskIds: readonly string[],
  workspaceId: string,
  reader: Reader = db,
): Promise<Map<string, RelatedTask>> {
  const ids = [...new Set(taskIds)];
  const tasks = new Map<string, RelatedTask>();
  if (ids.length === 0) return tasks;

  const rows = await reader
    .select({
      id: taskTable.id,
      title: taskTable.title,
      status: taskTable.status,
      priority: taskTable.priority,
      number: taskTable.number,
      projectId: taskTable.projectId,
      projectSlug: projectTable.slug,
      projectName: projectTable.name,
      group: taskGroupSql,
      userId: taskTable.userId,
      assigneeName: userTable.name,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(columnTable, taskColumnJoin)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        inArray(taskTable.id, ids),
        eq(projectTable.workspaceId, workspaceId),
        // Trashed tasks read as gone (C7): relations to them are hidden
        // until a restore.
        liveTaskCondition,
        // So are tasks of a restricted project the caller cannot see.
        notHiddenProject(
          projectTable.id,
          await hiddenForCurrentRequest(workspaceId),
        ),
      ),
    );

  // Full lists, so subtask and relation rows can draw every assignee.
  const assigneesByTask = await assigneesOfTasks(
    rows.map((task) => task.id),
    reader,
  );
  for (const task of rows) {
    tasks.set(task.id, {
      ...task,
      assigneeIds: assigneesByTask.get(task.id) ?? [],
    });
  }
  return tasks;
}
