import { and, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import db from "../../database";
import {
  cycleTable,
  moduleTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { inTriageColumnSql, liveTaskCondition } from "../../task/scope";
import type { ArchiveScope } from "../scope";

const countValue = sql<number>`count(*)::int`;

async function countArchivedTasks(scope: ArchiveScope) {
  const [row] = await db
    .select({ value: countValue })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        scope.projects,
        isNotNull(taskTable.archivedAt),
        liveTaskCondition,
        sql`not ${inTriageColumnSql}`,
      ),
    );
  return row?.value ?? 0;
}

async function countArchivedCycles(scope: ArchiveScope) {
  const [row] = await db
    .select({ value: countValue })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(
      and(
        scope.projects,
        eq(projectTable.cyclesEnabled, true),
        isNotNull(cycleTable.archivedAt),
      ),
    );
  return row?.value ?? 0;
}

async function countArchivedModules(scope: ArchiveScope) {
  const [row] = await db
    .select({ value: countValue })
    .from(moduleTable)
    .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
    .where(
      and(
        scope.projects,
        eq(projectTable.modulesEnabled, true),
        isNotNull(moduleTable.archivedAt),
      ),
    );
  return row?.value ?? 0;
}

async function countArchivedProjects(workspaceId: string) {
  const [row] = await db
    .select({ value: countValue })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNotNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ) as SQL,
    );
  return row?.value ?? 0;
}

/**
 * Tab counts for the Archives screen; null hides a tab the caller can't
 * read or that no project in scope uses.
 */
export async function getArchiveSummary(scope: ArchiveScope) {
  const [tasks, cycles, modules, projects] = await Promise.all([
    scope.can.taskRead ? countArchivedTasks(scope) : null,
    scope.can.cycleRead && scope.cyclesOn ? countArchivedCycles(scope) : null,
    scope.can.moduleRead && scope.modulesOn
      ? countArchivedModules(scope)
      : null,
    scope.projectId ? null : countArchivedProjects(scope.workspaceId),
  ]);
  return { tasks, cycles, modules, projects };
}
