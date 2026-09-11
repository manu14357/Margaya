import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleTable, moduleTaskTable, taskTable } from "../../database/schema";
import { removeEntityReferences } from "../../entity-reference/registry";
import { publishEvent } from "../../events";
import { type ModuleActivity, recordModuleActivity } from "./membership";
import { lockModule } from "./shared";

/**
 * Deletes a module for callers with module:delete, or for its creator.
 * Archived modules can be deleted too. Tasks stay in the project; links,
 * members and memberships cascade away with the module.
 */
async function deleteModule({
  moduleId,
  userId,
  canDeleteAnyModule,
}: {
  moduleId: string;
  userId: string;
  canDeleteAnyModule: boolean;
}) {
  const { deleted, removedTaskIds } = await db.transaction(async (tx) => {
    const deleted = await lockModule(tx, moduleId);
    if (!canDeleteAnyModule && deleted.createdBy !== userId) {
      throw new HTTPException(403, {
        message: "Only workspace admins or the module's creator can delete it",
      });
    }

    const linked = await tx
      .select({ taskId: moduleTaskTable.taskId })
      .from(moduleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, moduleTaskTable.taskId))
      .where(
        and(
          eq(moduleTaskTable.moduleId, moduleId),
          eq(taskTable.projectId, deleted.projectId),
        ),
      );
    const removedTaskIds = linked.map((row) => row.taskId);

    const entries: ModuleActivity[] = removedTaskIds.map((taskId) => ({
      taskId,
      moduleId,
      moduleName: deleted.name,
      type: "module_removed",
      reason: "module_deleted",
    }));
    await recordModuleActivity(tx, entries, userId);
    await tx.delete(moduleTable).where(eq(moduleTable.id, moduleId));
    return { deleted, removedTaskIds };
  });

  await removeEntityReferences("module", [moduleId]);

  await publishEvent("module.deleted", {
    moduleId,
    projectId: deleted.projectId,
    userId,
    name: deleted.name,
    removedTaskIds,
  });

  return { id: moduleId, projectId: deleted.projectId, removedTaskIds };
}

export default deleteModule;
