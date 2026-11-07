import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../../database";
import {
  columnTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { taskColumnJoin } from "../../task/scope";
import { isBlockedSql } from "../../task-query/keys/blocked";

/** The relation types that order two tasks in time. */
export const DEPENDENCY_RELATION_TYPES = [
  "blocks",
  "start_before",
  "finish_before",
] as const;

export type DependencyRelationType = (typeof DEPENDENCY_RELATION_TYPES)[number];

// A task holds at most 200 relations, but a large project can still hold many
// thousands; the timeline only draws the ones between visible bars.
export const MAX_PROJECT_DEPENDENCIES = 5000;

const sourceTask = alias(taskTable, "dependency_source_task");
const targetTask = alias(taskTable, "dependency_target_task");

/**
 * Every date-ordering relation whose two tasks both belong to the project and
 * are not archived, oldest first. Only ids and the type: the board payload
 * already carries the tasks themselves. Also the project's blocked tasks,
 * whose blocker may sit in another project and so have no relation here;
 * blockers in `uncountedBlockerProjectIds` don't count.
 */
async function getProjectDependencies(
  projectId: string,
  uncountedBlockerProjectIds: readonly string[] = [],
) {
  const [rows, blocked] = await Promise.all([
    db
      .select({
        id: taskRelationTable.id,
        sourceTaskId: taskRelationTable.sourceTaskId,
        targetTaskId: taskRelationTable.targetTaskId,
        relationType: taskRelationTable.relationType,
      })
      .from(taskRelationTable)
      .innerJoin(sourceTask, eq(sourceTask.id, taskRelationTable.sourceTaskId))
      .innerJoin(targetTask, eq(targetTask.id, taskRelationTable.targetTaskId))
      .where(
        and(
          eq(sourceTask.projectId, projectId),
          eq(targetTask.projectId, projectId),
          isNull(sourceTask.archivedAt),
          isNull(targetTask.archivedAt),
          isNull(sourceTask.deletedAt),
          isNull(targetTask.deletedAt),
          inArray(taskRelationTable.relationType, [
            ...DEPENDENCY_RELATION_TYPES,
          ]),
        ),
      )
      .orderBy(asc(taskRelationTable.createdAt), asc(taskRelationTable.id))
      .limit(MAX_PROJECT_DEPENDENCIES + 1),
    db
      .select({ id: taskTable.id })
      .from(taskTable)
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          eq(taskTable.projectId, projectId),
          isNull(taskTable.archivedAt),
          isNull(taskTable.deletedAt),
          isBlockedSql(uncountedBlockerProjectIds),
        ),
      )
      .limit(MAX_PROJECT_DEPENDENCIES),
  ]);

  return {
    relations: rows.slice(0, MAX_PROJECT_DEPENDENCIES).map((row) => ({
      ...row,
      relationType: row.relationType as DependencyRelationType,
    })),
    truncated: rows.length > MAX_PROJECT_DEPENDENCIES,
    blockedTaskIds: blocked.map((row) => row.id),
  };
}

export default getProjectDependencies;
