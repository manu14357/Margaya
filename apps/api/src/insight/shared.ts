import { and, eq, inArray, sql } from "drizzle-orm";
import { columnTable, projectTable, taskTable } from "../database/schema";
import { loadTaskFlows } from "../delivery/flow-history";
import { cycleTimeDays } from "../delivery/flow-intervals";
import type { Reader } from "../task/progress-queries";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";

// Small helpers the insight features share: task keys, task references and
// the cycle time of completed tasks (delivery/ history rebuild).

export type InsightTaskRef = {
  id: string;
  key: string;
  title: string;
  projectId: string;
};

export function taskKey(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

/** The project's key prefix (its slug), or null for a missing project. */
export async function projectSlug(
  reader: Reader,
  projectId: string,
): Promise<string | null> {
  const [row] = await reader
    .select({ slug: projectTable.slug })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return row?.slug ?? null;
}

/**
 * Cycle time in days of completed tasks of one project, by task id. Tasks
 * that never visibly entered a started column are missing.
 */
export async function completedCycleDays(
  reader: Reader,
  projectId: string,
  taskIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (taskIds.length === 0) return result;
  const rows = await reader
    .select({
      id: taskTable.id,
      status: taskTable.status,
      createdAt: taskTable.createdAt,
      completedAt: taskTable.completedAt,
      group: taskGroupSql,
    })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(taskTable.id, [...taskIds]),
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
        sql`${taskGroupSql} = 'completed'`,
      ),
    );
  const flows = await loadTaskFlows(reader, projectId, rows);
  for (const task of flows) {
    if (!task.completedAt) continue;
    const days = cycleTimeDays(task.flow, task.completedAt);
    if (days !== null) result.set(task.id, days);
  }
  return result;
}
