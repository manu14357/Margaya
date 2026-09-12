import { and, eq, isNull, sql } from "drizzle-orm";
import {
  columnTable,
  moduleTable,
  moduleTaskTable,
  taskTable,
} from "../../database/schema";
import { MODULE_STATUSES, type ModuleStatus } from "../../module/types";
import { taskColumnJoin, visibleTaskCondition } from "../../task/scope";
import { textArray } from "../../task-query/context";
import { MetaStore } from "../../task-query/hydrate";
import type { AnalyticsModuleRow, AnalyticsModules } from "../response";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
  projectRank,
  projectsMeta,
  projectsWithFeature,
} from "../scope";
import {
  EMPTY_TALLY,
  hasPointsSystemSql,
  livePoints,
  type PlanningTally,
  planningNumbers,
  planningTallyColumns,
  toPlanningTally,
} from "./planning";

// The modules tab (AN5, B8 §2A.9): the modules, one grouped count and
// points statement with the module progress route's rules (links to tasks of
// the module's own project, visible scope), and the leads' names.

export const MAX_MODULE_ROWS = 300;

const CLOSED_MODULE_STATUSES: readonly string[] = ["completed", "cancelled"];

type ModuleRecord = {
  id: string;
  projectId: string;
  name: string;
  status: ModuleStatus;
  leadId: string | null;
  startDate: string | null;
  targetDate: string | null;
  hasPointsSystem: boolean;
};

/** Past its target date and not completed or cancelled (UTC today, D2). */
export function isModuleOverdue(
  module: { targetDate: string | null; status: string },
  today: string,
): boolean {
  return (
    module.targetDate !== null &&
    module.targetDate < today &&
    !CLOSED_MODULE_STATUSES.includes(module.status)
  );
}

/** Project position, status order, target date (none last), then name. */
export function compareModuleRows(
  a: ModuleRecord & { rank: number },
  b: ModuleRecord & { rank: number },
): number {
  const statusRank = (status: string) =>
    MODULE_STATUSES.indexOf(status as ModuleStatus);
  const target = (value: string | null) => value ?? "￿";
  return (
    a.rank - b.rank ||
    statusRank(a.status) - statusRank(b.status) ||
    target(a.targetDate).localeCompare(target(b.targetDate)) ||
    a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) ||
    a.id.localeCompare(b.id)
  );
}

export async function getAnalyticsModules(
  caller: AnalyticsCaller,
  { projectIds, timeZone }: { projectIds?: string[]; timeZone?: string },
): Promise<AnalyticsModules> {
  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller, {
      projectIds,
      timeZone,
    });
    const today = context.utcToday;
    const enabled = projectsWithFeature(context, "modules");
    const byStatus: Record<string, number> = Object.fromEntries(
      MODULE_STATUSES.map((status) => [status, 0]),
    );
    const empty: AnalyticsModules = {
      today,
      enabledProjectIds: enabled,
      summary: { byStatus, overdue: 0 },
      rows: [],
      meta: { projects: [], users: [] },
    };
    if (enabled.length === 0) return empty;

    const records: ModuleRecord[] = await tx
      .select({
        id: moduleTable.id,
        projectId: moduleTable.projectId,
        name: moduleTable.name,
        status: moduleTable.status,
        leadId: moduleTable.leadId,
        startDate: moduleTable.startDate,
        targetDate: moduleTable.targetDate,
        hasPointsSystem: hasPointsSystemSql(moduleTable.projectId),
      })
      .from(moduleTable)
      .where(
        and(
          sql`${moduleTable.projectId} = any(${textArray(enabled)})`,
          isNull(moduleTable.archivedAt),
        ),
      );
    if (records.length === 0) return empty;

    const tallies = new Map<string, PlanningTally>();
    const tallyRows = await tx
      .select({
        moduleId: moduleTaskTable.moduleId,
        ...planningTallyColumns(context),
      })
      .from(moduleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, moduleTaskTable.taskId))
      .innerJoin(
        moduleTable,
        and(
          eq(moduleTable.id, moduleTaskTable.moduleId),
          eq(moduleTable.projectId, taskTable.projectId),
        ),
      )
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          sql`${moduleTaskTable.moduleId} = any(${textArray(records.map((found) => found.id))})`,
          visibleTaskCondition,
        ),
      )
      .groupBy(moduleTaskTable.moduleId);
    for (const row of tallyRows)
      tallies.set(row.moduleId, toPlanningTally(row));

    const rank = projectRank(context);
    const estimatesOn = new Set(projectsWithFeature(context, "estimates"));
    const ordered = records
      .map((found) => ({
        ...found,
        rank: rank.get(found.projectId) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort(compareModuleRows);

    let overdue = 0;
    for (const found of ordered) {
      byStatus[found.status] = (byStatus[found.status] ?? 0) + 1;
      if (isModuleOverdue(found, today)) overdue++;
    }

    const rows: AnalyticsModuleRow[] = ordered
      .slice(0, MAX_MODULE_ROWS)
      .map((found) => {
        const tally = tallies.get(found.id) ?? EMPTY_TALLY;
        return {
          id: found.id,
          projectId: found.projectId,
          name: found.name,
          status: found.status,
          leadId: found.leadId,
          startDate: found.startDate,
          targetDate: found.targetDate,
          isOverdue: isModuleOverdue(found, today),
          ...planningNumbers(tally.counts),
          ...livePoints(
            tally,
            estimatesOn.has(found.projectId) && found.hasPointsSystem,
          ),
        };
      });

    const store = new MetaStore(tx, context);
    const leadIds = [
      ...new Set(rows.flatMap((row) => (row.leadId ? [row.leadId] : []))),
    ];
    await store.loadUsers(leadIds);

    return {
      ...empty,
      summary: { byStatus, overdue },
      rows,
      meta: {
        projects: projectsMeta(
          context,
          rows.map((row) => row.projectId),
        ),
        users: leadIds.flatMap((id) => {
          const user = store.users.get(id);
          return user
            ? [{ id: user.id, name: user.name, image: user.image }]
            : [];
        }),
      },
    };
  });
}
