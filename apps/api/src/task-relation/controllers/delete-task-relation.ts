import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import {
  hiddenForCurrentRequest,
  notHiddenProject,
} from "../../project/visibility";
import { publishRelationEvent } from "../events";

async function deleteTaskRelation(
  id: string,
  userId: string,
  workspaceId: string,
) {
  const workspaceTasks = db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        notHiddenProject(
          projectTable.id,
          await hiddenForCurrentRequest(workspaceId),
        ),
      ),
    );

  // Check both endpoints in the delete statement itself. Legacy cross-tenant
  // rows and tasks the caller can't reach must not bypass the same boundary
  // enforced on creation and reads.
  const [relation] = await db
    .delete(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.id, id),
        inArray(taskRelationTable.sourceTaskId, workspaceTasks),
        inArray(taskRelationTable.targetTaskId, workspaceTasks),
      ),
    )
    .returning();

  if (!relation) {
    throw new HTTPException(404, {
      message: "Task relation not found",
    });
  }

  await publishRelationEvent("task-relation.deleted", {
    relation,
    userId,
    origin: "user",
  });

  return relation;
}

export default deleteTaskRelation;
