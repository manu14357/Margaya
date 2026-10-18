import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { pendingScopeTaskIds } from "../cycle/queries";
import {
  columnTable,
  cycleTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { linkModuleJoin, linkTaskJoin } from "../module/queries";
import type { Reader } from "../task/progress-queries";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { resolveTimezone } from "../utils/zoned-date";

// What a forecast or risk read is about: a cycle, a module or a whole
// project, with its project, workspace zone and end date. The route
// middleware has already checked access; this only resolves.

export const SCOPE_TYPES = ["cycle", "module", "project"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export type DeliveryScope = {
  type: ScopeType;
  id: string;
  projectId: string;
  workspaceId: string;
  timeZone: string;
  projectCreatedAt: Date;
  /** The cycle's end or the module's target date; null for a project. */
  endDate: string | null;
};

const OPEN_GROUPS = sql`${taskGroupSql} in ('backlog', 'unstarted', 'started')`;

async function projectInfo(reader: Reader, projectId: string) {
  const [row] = await reader
    .select({
      workspaceId: projectTable.workspaceId,
      createdAt: projectTable.createdAt,
      timezone: workspaceTable.timezone,
    })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Project not found" });
  return row;
}

export async function resolveScope(
  reader: Reader,
  type: ScopeType,
  id: string,
): Promise<DeliveryScope> {
  let projectId = id;
  let endDate: string | null = null;
  if (type === "cycle") {
    const [cycle] = await reader
      .select({ projectId: cycleTable.projectId, endDate: cycleTable.endDate })
      .from(cycleTable)
      .where(eq(cycleTable.id, id))
      .limit(1);
    if (!cycle) throw new HTTPException(404, { message: "Cycle not found" });
    projectId = cycle.projectId;
    endDate = cycle.endDate;
  } else if (type === "module") {
    const [module] = await reader
      .select({
        projectId: moduleTable.projectId,
        targetDate: moduleTable.targetDate,
      })
      .from(moduleTable)
      .where(eq(moduleTable.id, id))
      .limit(1);
    if (!module) throw new HTTPException(404, { message: "Module not found" });
    projectId = module.projectId;
    endDate = module.targetDate;
  }
  const project = await projectInfo(reader, projectId);
  return {
    type,
    id,
    projectId,
    workspaceId: project.workspaceId,
    timeZone: resolveTimezone(project.timezone),
    projectCreatedAt: project.createdAt,
    endDate,
  };
}

/**
 * Ids of the scope's open tasks (backlog, not started, started), counted
 * the way cycle and module progress count them. At most `limit`.
 */
export async function openScopeTaskIds(
  reader: Reader,
  scope: DeliveryScope,
  limit: number,
): Promise<string[]> {
  if (scope.type === "cycle") {
    return (await pendingScopeTaskIds(reader, scope.id)).slice(0, limit);
  }
  if (scope.type === "module") {
    const rows = await reader
      .select({ id: taskTable.id })
      .from(moduleTaskTable)
      .innerJoin(taskTable, linkTaskJoin)
      .innerJoin(moduleTable, linkModuleJoin)
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          eq(moduleTaskTable.moduleId, scope.id),
          visibleTaskCondition,
          OPEN_GROUPS,
        ),
      )
      .limit(limit);
    return rows.map((row) => row.id);
  }
  const rows = await reader
    .select({ id: taskTable.id })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, scope.projectId),
        visibleTaskCondition,
        OPEN_GROUPS,
      ),
    )
    .limit(limit);
  return rows.map((row) => row.id);
}
