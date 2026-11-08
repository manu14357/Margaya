import { and, eq, inArray, ne } from "drizzle-orm";
import { withAutomationMarker } from "../../automation-rule/context";
import {
  activityTable,
  moduleTable,
  moduleTaskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import type { Transaction } from "../queries";

/** One task entering or leaving one module, recorded as task activity. */
export type ModuleActivity = {
  taskId: string;
  moduleId: string;
  moduleName: string;
  type: "module_added" | "module_removed";
  /** Set when the task left because the module was deleted. */
  reason?: "module_deleted";
};

const ACTIVITY_BATCH_SIZE = 500;

/**
 * Writes the activity rows inside the membership transaction, so history
 * can't go missing when a subscriber fails. Deletes can touch thousands of
 * tasks, hence the batches. Each row stores its module's project: the task can
 * move and the module can go, and the row must still say whose name it holds
 * (task-activity/redact.ts).
 */
export async function recordModuleActivity(
  tx: Transaction,
  entries: readonly ModuleActivity[],
  userId: string,
) {
  const moduleIds = [...new Set(entries.map((entry) => entry.moduleId))];
  const modules =
    moduleIds.length === 0
      ? []
      : await tx
          .select({ id: moduleTable.id, projectId: moduleTable.projectId })
          .from(moduleTable)
          .where(inArray(moduleTable.id, moduleIds));
  const projectOf = new Map(modules.map((row) => [row.id, row.projectId]));

  for (let i = 0; i < entries.length; i += ACTIVITY_BATCH_SIZE) {
    await tx.insert(activityTable).values(
      entries
        .slice(i, i + ACTIVITY_BATCH_SIZE)
        .map(({ taskId, type, ...eventData }) => ({
          taskId,
          type,
          userId,
          content: null,
          eventData: withAutomationMarker({
            ...eventData,
            moduleProjectId: projectOf.get(eventData.moduleId) ?? null,
          }),
        })),
    );
  }
}

/** Publishes `module.tasks_changed` when anything changed. */
export async function publishModuleTasksChanged({
  projectId,
  userId,
  moduleId,
  moduleName,
  added,
  removed,
}: {
  projectId: string;
  userId: string;
  moduleId: string;
  moduleName: string;
  added: readonly string[];
  removed: readonly string[];
}) {
  if (added.length === 0 && removed.length === 0) return;
  await publishEvent("module.tasks_changed", {
    moduleId,
    projectId,
    userId,
    moduleName,
    added,
    removed,
  });
}

/**
 * Takes a task out of the modules of every project but `toProjectId` and
 * records the activity. Call it inside the transaction that moves the task
 * to another project, then pass the result to `publishModuleDetachments`
 * after the commit.
 */
export async function detachTaskFromOtherProjectModules(
  tx: Transaction,
  taskId: string,
  toProjectId: string,
  userId: string,
): Promise<ModuleActivity[]> {
  const stale = await tx
    .select({
      linkId: moduleTaskTable.id,
      moduleId: moduleTable.id,
      moduleName: moduleTable.name,
    })
    .from(moduleTaskTable)
    .innerJoin(moduleTable, eq(moduleTable.id, moduleTaskTable.moduleId))
    .where(
      and(
        eq(moduleTaskTable.taskId, taskId),
        ne(moduleTable.projectId, toProjectId),
      ),
    );
  if (stale.length === 0) return [];

  await tx.delete(moduleTaskTable).where(
    inArray(
      moduleTaskTable.id,
      stale.map((row) => row.linkId),
    ),
  );

  const entries: ModuleActivity[] = stale.map((row) => ({
    taskId,
    moduleId: row.moduleId,
    moduleName: row.moduleName,
    type: "module_removed",
  }));
  await recordModuleActivity(tx, entries, userId);
  return entries;
}

/** One `module.tasks_changed` per module the moved task left. */
export async function publishModuleDetachments({
  projectId,
  userId,
  entries,
}: {
  projectId: string;
  userId: string;
  entries: readonly ModuleActivity[];
}) {
  for (const entry of entries) {
    await publishModuleTasksChanged({
      projectId,
      userId,
      moduleId: entry.moduleId,
      moduleName: entry.moduleName,
      added: [],
      removed: [entry.taskId],
    });
  }
}
