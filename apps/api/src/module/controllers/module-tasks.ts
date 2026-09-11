import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { moduleTaskTable } from "../../database/schema";
import { visibleProjectTaskIds } from "../queries";
import {
  type ModuleActivity,
  publishModuleTasksChanged,
  recordModuleActivity,
} from "./membership";
import { assertNotArchived, lockModule, uniqueIds } from "./shared";

export type ModuleTaskChange = {
  moduleId: string;
  added: string[];
  removed: string[];
  unchanged: string[];
  ignored: string[];
};

function emptyChange(moduleId: string): ModuleTaskChange {
  return { moduleId, added: [], removed: [], unchanged: [], ignored: [] };
}

function activityOf(
  taskIds: string[],
  moduleId: string,
  moduleName: string,
  type: ModuleActivity["type"],
): ModuleActivity[] {
  return taskIds.map((taskId) => ({ taskId, moduleId, moduleName, type }));
}

/**
 * Adds visible tasks of the module's project. Ids that are not (other
 * projects, archived, triage, unknown) come back as ignored.
 */
export async function addModuleTasks({
  moduleId,
  userId,
  taskIds,
}: {
  moduleId: string;
  userId: string;
  taskIds: string[];
}): Promise<ModuleTaskChange> {
  const ids = uniqueIds(taskIds);

  const { found, result } = await db.transaction(async (tx) => {
    const found = await lockModule(tx, moduleId);
    assertNotArchived(found);

    const valid = await visibleProjectTaskIds(tx, found.projectId, ids);
    const result = emptyChange(moduleId);
    result.ignored = ids.filter((id) => !valid.has(id));
    const candidates = ids.filter((id) => valid.has(id));

    const inserted =
      candidates.length > 0
        ? await tx
            .insert(moduleTaskTable)
            .values(
              candidates.map((taskId) => ({
                moduleId,
                taskId,
                createdBy: userId,
              })),
            )
            .onConflictDoNothing()
            .returning({ taskId: moduleTaskTable.taskId })
        : [];
    const insertedIds = new Set(inserted.map((row) => row.taskId));
    result.added = candidates.filter((id) => insertedIds.has(id));
    result.unchanged = candidates.filter((id) => !insertedIds.has(id));

    await recordModuleActivity(
      tx,
      activityOf(result.added, moduleId, found.name, "module_added"),
      userId,
    );
    return { found, result };
  });

  await publishModuleTasksChanged({
    projectId: found.projectId,
    userId,
    moduleId,
    moduleName: found.name,
    added: result.added,
    removed: [],
  });
  return result;
}

/**
 * Takes visible tasks of the module's project out of it. Ids that are not
 * (other projects, archived, triage, unknown) come back as ignored.
 */
export async function removeModuleTasks({
  moduleId,
  userId,
  taskIds,
}: {
  moduleId: string;
  userId: string;
  taskIds: string[];
}): Promise<ModuleTaskChange> {
  const ids = uniqueIds(taskIds);

  const { found, result } = await db.transaction(async (tx) => {
    const found = await lockModule(tx, moduleId);
    assertNotArchived(found);

    const valid = await visibleProjectTaskIds(tx, found.projectId, ids);
    const result = emptyChange(moduleId);
    result.ignored = ids.filter((id) => !valid.has(id));
    const candidates = ids.filter((id) => valid.has(id));

    const deleted =
      candidates.length > 0
        ? await tx
            .delete(moduleTaskTable)
            .where(
              and(
                eq(moduleTaskTable.moduleId, moduleId),
                inArray(moduleTaskTable.taskId, candidates),
              ),
            )
            .returning({ taskId: moduleTaskTable.taskId })
        : [];
    const deletedIds = new Set(deleted.map((row) => row.taskId));
    result.removed = candidates.filter((id) => deletedIds.has(id));
    result.unchanged = candidates.filter((id) => !deletedIds.has(id));

    await recordModuleActivity(
      tx,
      activityOf(result.removed, moduleId, found.name, "module_removed"),
      userId,
    );
    return { found, result };
  });

  await publishModuleTasksChanged({
    projectId: found.projectId,
    userId,
    moduleId,
    moduleName: found.name,
    added: [],
    removed: result.removed,
  });
  return result;
}
