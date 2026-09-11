import { and, asc, count, eq } from "drizzle-orm";
import type { CreatableColumnGroup } from "../../column/groups";
import db from "../../database";
import {
  columnTable,
  moduleTable,
  moduleTaskTable,
  taskTable,
} from "../../database/schema";
import { assigneesOfTasks } from "../../task/assignees";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../../task/scope";
import { linkModuleJoin, linkTaskJoin } from "../queries";

const DEFAULT_PAGE_SIZE = 50;

/** The module's visible tasks by number, a page at a time (API and exports). */
async function listModuleTasks(
  moduleId: string,
  { page = 1, limit = DEFAULT_PAGE_SIZE }: { page?: number; limit?: number },
) {
  const inScope = and(
    eq(moduleTaskTable.moduleId, moduleId),
    visibleTaskCondition,
  );

  return db.transaction(
    async (tx) => {
      const [totals] = await tx
        .select({ total: count() })
        .from(moduleTaskTable)
        .innerJoin(taskTable, linkTaskJoin)
        .innerJoin(moduleTable, linkModuleJoin)
        .where(inScope);
      const total = Number(totals?.total ?? 0);

      const rows = await tx
        .select({
          id: taskTable.id,
          number: taskTable.number,
          title: taskTable.title,
          status: taskTable.status,
          group: taskGroupSql,
          priority: taskTable.priority,
          userId: taskTable.userId,
          dueDate: taskTable.dueDate,
        })
        .from(moduleTaskTable)
        .innerJoin(taskTable, linkTaskJoin)
        .innerJoin(moduleTable, linkModuleJoin)
        .leftJoin(columnTable, taskColumnJoin)
        .where(inScope)
        .orderBy(asc(taskTable.number), asc(taskTable.id))
        .limit(limit)
        .offset((page - 1) * limit);

      const assigneesByTask = await assigneesOfTasks(
        rows.map((row) => row.id),
        tx,
      );

      return {
        // Visible tasks never resolve to the archived (null) group.
        tasks: rows.map((row) => ({
          ...row,
          assigneeIds: assigneesByTask.get(row.id) ?? [],
          group: (row.group ?? "unstarted") as CreatableColumnGroup,
        })),
        pagination: {
          total,
          page,
          pageSize: limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export default listModuleTasks;
