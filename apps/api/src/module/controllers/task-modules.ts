import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleTable, moduleTaskTable, taskTable } from "../../database/schema";
import { inTriageColumnSql } from "../../task/scope";
import { linkModuleJoin, linkTaskJoin } from "../queries";
import {
  type ModuleActivity,
  publishModuleTasksChanged,
  recordModuleActivity,
} from "./membership";
import { RESTORE_BEFORE_EDITING, uniqueIds } from "./shared";

/**
 * Every (task, module) pair of the project's active modules. Archived tasks
 * are included; clients decide what to show.
 */
export async function getModuleTaskMap(projectId: string) {
  return db
    .select({
      taskId: moduleTaskTable.taskId,
      moduleId: moduleTaskTable.moduleId,
    })
    .from(moduleTaskTable)
    .innerJoin(taskTable, linkTaskJoin)
    .innerJoin(moduleTable, linkModuleJoin)
    .where(
      and(
        eq(moduleTable.projectId, projectId),
        isNull(moduleTable.archivedAt),
        // Trashed tasks read as gone (C7).
        isNull(taskTable.deletedAt),
      ),
    )
    .orderBy(asc(moduleTaskTable.moduleId), asc(moduleTaskTable.taskId));
}

/** The task's active modules, by name. */
export async function getTaskModules(taskId: string) {
  return db
    .select({
      id: moduleTable.id,
      name: moduleTable.name,
      status: moduleTable.status,
    })
    .from(moduleTaskTable)
    .innerJoin(taskTable, linkTaskJoin)
    .innerJoin(moduleTable, linkModuleJoin)
    .where(
      and(eq(moduleTaskTable.taskId, taskId), isNull(moduleTable.archivedAt)),
    )
    .orderBy(
      asc(sql`lower(${moduleTable.name})`),
      asc(moduleTable.name),
      asc(moduleTable.id),
    );
}

async function loadTask(taskId: string) {
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      archivedAt: taskTable.archivedAt,
      inTriage: inTriageColumnSql,
    })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

/**
 * Adds the task to some modules and takes it out of others, idempotently.
 * Every module must be an active module of the task's project; archived or
 * triage tasks can only leave modules.
 */
export async function setTaskModules({
  taskId,
  userId,
  addModuleIds = [],
  removeModuleIds = [],
}: {
  taskId: string;
  userId: string;
  addModuleIds?: string[];
  removeModuleIds?: string[];
}) {
  const toAdd = uniqueIds(addModuleIds);
  const toRemove = uniqueIds(removeModuleIds);
  if (toAdd.length === 0 && toRemove.length === 0) {
    throw new HTTPException(400, { message: "Nothing to change" });
  }
  const removing = new Set(toRemove);
  if (toAdd.some((id) => removing.has(id))) {
    throw new HTTPException(400, {
      message: "A module cannot be both added and removed",
    });
  }

  const task = await loadTask(taskId);

  const { modules, added, removed } = await db.transaction(async (tx) => {
    const ids = [...toAdd, ...toRemove];
    const modules = await tx
      .select({
        id: moduleTable.id,
        name: moduleTable.name,
        archivedAt: moduleTable.archivedAt,
      })
      .from(moduleTable)
      .where(
        and(
          inArray(moduleTable.id, ids),
          eq(moduleTable.projectId, task.projectId),
        ),
      )
      .for("update");
    const byId = new Map(modules.map((found) => [found.id, found]));

    // Unknown ids and modules of other projects or workspaces look the same.
    const foreignId = ids.find((id) => !byId.has(id));
    if (foreignId) {
      throw new HTTPException(400, {
        message: `Module ${foreignId} does not belong to this task's project`,
      });
    }
    if (modules.some((found) => found.archivedAt)) {
      throw new HTTPException(409, { message: RESTORE_BEFORE_EDITING });
    }
    if (
      toAdd.length > 0 &&
      (task.archivedAt !== null || Boolean(task.inTriage))
    ) {
      throw new HTTPException(409, {
        message: "Archived tasks cannot be added to modules",
      });
    }

    const inserted =
      toAdd.length > 0
        ? await tx
            .insert(moduleTaskTable)
            .values(
              toAdd.map((moduleId) => ({
                moduleId,
                taskId,
                createdBy: userId,
              })),
            )
            .onConflictDoNothing()
            .returning({ moduleId: moduleTaskTable.moduleId })
        : [];
    const deleted =
      toRemove.length > 0
        ? await tx
            .delete(moduleTaskTable)
            .where(
              and(
                eq(moduleTaskTable.taskId, taskId),
                inArray(moduleTaskTable.moduleId, toRemove),
              ),
            )
            .returning({ moduleId: moduleTaskTable.moduleId })
        : [];

    const added = inserted.map((row) => row.moduleId);
    const removed = deleted.map((row) => row.moduleId);
    const entries: ModuleActivity[] = [
      ...added.map((moduleId) => ({
        taskId,
        moduleId,
        moduleName: byId.get(moduleId)?.name ?? "",
        type: "module_added" as const,
      })),
      ...removed.map((moduleId) => ({
        taskId,
        moduleId,
        moduleName: byId.get(moduleId)?.name ?? "",
        type: "module_removed" as const,
      })),
    ];
    await recordModuleActivity(tx, entries, userId);
    return { modules: byId, added, removed };
  });

  for (const moduleId of [...added, ...removed]) {
    await publishModuleTasksChanged({
      projectId: task.projectId,
      userId,
      moduleId,
      moduleName: modules.get(moduleId)?.name ?? "",
      added: added.includes(moduleId) ? [taskId] : [],
      removed: removed.includes(moduleId) ? [taskId] : [],
    });
  }

  return getTaskModules(taskId);
}
