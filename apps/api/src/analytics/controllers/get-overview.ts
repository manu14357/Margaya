import { and, count, eq, isNull, lt, sql } from "drizzle-orm";
import { OPEN_COLUMN_GROUPS } from "../../column/groups";
import { deriveCycleStatus } from "../../cycle/dates";
import {
  columnTable,
  cycleTable,
  intakeItemTable,
  moduleTable,
  taskTable,
  workspaceUserTable,
} from "../../database/schema";
import { effectiveStatusSql } from "../../intake/queries";
import { MODULE_STATUSES } from "../../module/types";
import {
  EMPTY_COUNTS,
  type GroupCounts,
  progressOf,
} from "../../task/progress";
import { taskColumnJoin, taskGroupSql } from "../../task/scope";
import { textArray } from "../../task-query/context";
import { startOfZonedDay } from "../../task-query/dates";
import type { AnalyticsOverview } from "../response";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
  projectsMeta,
  projectsWithFeature,
  taskSetCondition,
} from "../scope";

// Workspace headline numbers (AN1, B8 §2A.7): at most six statements. Task
// numbers use the visible scope without filters; members are workspace-wide
// (D6). The cycle, module and intake sections are null when no scope
// project has the feature on or the caller may not read it.

export type OverviewSections = {
  cycles: boolean;
  modules: boolean;
  intake: boolean;
};

const BUILT_IN_ROLE_ORDER = ["owner", "admin", "member", "viewer"];

/** owner, admin, member, viewer, then custom roles by name. */
export function orderRoles<T extends { role: string }>(rows: T[]): T[] {
  const rank = (role: string) => {
    const index = BUILT_IN_ROLE_ORDER.indexOf(role);
    return index < 0 ? BUILT_IN_ROLE_ORDER.length : index;
  };
  return [...rows].sort(
    (a, b) => rank(a.role) - rank(b.role) || a.role.localeCompare(b.role),
  );
}

type TaskNumbers = GroupCounts & { progress: number; overdue: number };

function taskNumbers(counts: GroupCounts, overdue: number): TaskNumbers {
  return { ...counts, progress: progressOf(counts), overdue };
}

type GroupRow = { projectId: string; grp: string; n: number; overdue: number };

function addToCounts(counts: GroupCounts, group: string, n: number) {
  counts.total += n;
  if (group in counts && group !== "total") {
    counts[group as Exclude<keyof GroupCounts, "total">] += n;
  }
}

export async function getAnalyticsOverview(
  caller: AnalyticsCaller,
  {
    projectIds,
    timeZone,
    sections,
  }: {
    projectIds?: string[];
    timeZone?: string;
    sections: OverviewSections;
  },
): Promise<AnalyticsOverview> {
  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller, {
      projectIds,
      timeZone,
    });

    const roles = await tx
      .select({ role: workspaceUserTable.role, count: count() })
      .from(workspaceUserTable)
      .where(eq(workspaceUserTable.workspaceId, caller.workspaceId))
      .groupBy(workspaceUserTable.role);
    const byRole = orderRoles(
      roles.map((row) => ({ role: row.role, count: Number(row.count) })),
    );

    const todayStart = startOfZonedDay(context.today, context.timeZone);
    const openGroups = sql.join(
      OPEN_COLUMN_GROUPS.map((group) => sql`${group}`),
      sql`, `,
    );
    const { rows: groupRows } = await tx.execute<GroupRow>(sql`
      select project_id as "projectId", grp, count(*)::int as n,
        (count(*) filter (where overdue))::int as overdue
      from (
        select ${taskTable.projectId} as project_id, ${taskGroupSql} as grp,
          coalesce(${taskGroupSql} in (${openGroups}) and ${lt(taskTable.dueDate, todayStart)}, false) as overdue
        from ${taskTable} left join ${columnTable} on ${taskColumnJoin}
        where ${taskSetCondition(context)}
      ) as scoped
      group by project_id, grp`);

    const totals: GroupCounts = { ...EMPTY_COUNTS };
    let overdue = 0;
    const perProject = new Map(
      context.projectIds.map((id) => [
        id,
        { counts: { ...EMPTY_COUNTS }, overdue: 0 },
      ]),
    );
    for (const row of groupRows) {
      const n = Number(row.n);
      addToCounts(totals, row.grp, n);
      overdue += Number(row.overdue);
      const entry = perProject.get(row.projectId);
      if (entry) {
        addToCounts(entry.counts, row.grp, n);
        entry.overdue += Number(row.overdue);
      }
    }

    const cycleProjects = projectsWithFeature(context, "cycles");
    let cycles: AnalyticsOverview["cycles"] = null;
    if (sections.cycles && cycleProjects.length > 0) {
      const rows = await tx
        .select({
          startDate: cycleTable.startDate,
          endDate: cycleTable.endDate,
        })
        .from(cycleTable)
        .where(
          and(
            sql`${cycleTable.projectId} = any(${textArray(cycleProjects)})`,
            isNull(cycleTable.archivedAt),
          ),
        );
      cycles = { draft: 0, upcoming: 0, current: 0, completed: 0 };
      for (const row of rows)
        cycles[deriveCycleStatus(row, context.utcToday)]++;
    }

    const moduleProjects = projectsWithFeature(context, "modules");
    let modules: AnalyticsOverview["modules"] = null;
    if (sections.modules && moduleProjects.length > 0) {
      const rows = await tx
        .select({ status: moduleTable.status, count: count() })
        .from(moduleTable)
        .where(
          and(
            sql`${moduleTable.projectId} = any(${textArray(moduleProjects)})`,
            isNull(moduleTable.archivedAt),
          ),
        )
        .groupBy(moduleTable.status);
      const byStatus: Record<string, number> = Object.fromEntries(
        MODULE_STATUSES.map((status) => [status, 0]),
      );
      let total = 0;
      for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
        total += Number(row.count);
      }
      modules = { total, byStatus };
    }

    const intakeProjects = projectsWithFeature(context, "intake");
    let intake: AnalyticsOverview["intake"] = null;
    if (sections.intake && intakeProjects.length > 0) {
      const rows = await tx
        .select({ status: effectiveStatusSql, count: count() })
        .from(intakeItemTable)
        .where(
          sql`${intakeItemTable.projectId} = any(${textArray(intakeProjects)})`,
        )
        .groupBy(effectiveStatusSql);
      intake = { open: 0, accepted: 0, declined: 0, duplicate: 0 };
      for (const row of rows) {
        const n = Number(row.count);
        if (row.status === "pending" || row.status === "snoozed") {
          intake.open += n;
        } else if (row.status in intake) {
          intake[row.status as "accepted" | "declined" | "duplicate"] += n;
        }
      }
    }

    return {
      today: context.today,
      members: {
        total: byRole.reduce((sum, row) => sum + row.count, 0),
        byRole,
      },
      projects: {
        total: context.projectIds.length,
        withFeature: {
          cycles: cycleProjects.length,
          modules: moduleProjects.length,
          intake: intakeProjects.length,
          estimates: projectsWithFeature(context, "estimates").length,
        },
      },
      tasks: taskNumbers(totals, overdue),
      projectRows: context.projectIds.map((projectId) => {
        const entry = perProject.get(projectId);
        return {
          projectId,
          ...taskNumbers(
            entry?.counts ?? { ...EMPTY_COUNTS },
            entry?.overdue ?? 0,
          ),
        };
      }),
      cycles,
      modules,
      intake,
      meta: { projects: projectsMeta(context) },
    };
  });
}
