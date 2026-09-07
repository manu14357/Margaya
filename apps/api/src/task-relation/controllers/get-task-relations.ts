import { asc, eq, or } from "drizzle-orm";
import db from "../../database";
import { taskRelationTable } from "../../database/schema";
import { loadRelatedTasks } from "../related-tasks";

/** Oldest first. Relations reaching outside the workspace are dropped. */
async function getTaskRelations(taskId: string, workspaceId: string) {
  const relations = await db
    .select({
      id: taskRelationTable.id,
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
      relationType: taskRelationTable.relationType,
      createdAt: taskRelationTable.createdAt,
    })
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, taskId),
        eq(taskRelationTable.targetTaskId, taskId),
      ),
    )
    .orderBy(asc(taskRelationTable.createdAt), asc(taskRelationTable.id));

  const tasks = await loadRelatedTasks(
    relations.flatMap((rel) => [rel.sourceTaskId, rel.targetTaskId]),
    workspaceId,
  );

  return relations
    .filter((rel) => tasks.has(rel.sourceTaskId) && tasks.has(rel.targetTaskId))
    .map((rel) => ({
      ...rel,
      sourceTask: tasks.get(rel.sourceTaskId) ?? null,
      targetTask: tasks.get(rel.targetTaskId) ?? null,
    }));
}

export default getTaskRelations;
