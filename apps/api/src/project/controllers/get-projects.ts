import { and, count, eq, isNull, sql } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable, taskTable } from "../../database/schema";
import {
  progressPercent,
  taskColumnJoin,
  taskGroupSql,
} from "../../task/scope";

type ProjectStatistics = {
  completionPercentage: number;
  totalTasks: number;
  dueDate: Date | null;
};

const EMPTY_STATISTICS: ProjectStatistics = {
  completionPercentage: 0,
  totalTasks: 0,
  dueDate: null,
};

async function getProjectStatistics(
  workspaceId: string,
  includeArchived: boolean,
) {
  const statisticsByProject = new Map<string, ProjectStatistics>();

  // Aggregate in the database instead of loading every task row into memory,
  // scoped by workspace through a join so the statement size stays constant.
  // Groups come from each task's column: a custom completed column counts as
  // done and cancelled work leaves the denominator. Archived tasks keep their
  // column (D7): archived open work counts as done, archived cancelled work
  // stays cancelled. Triage tasks belong to intake and are not counted.
  const rows = await db
    .select({
      projectId: taskTable.projectId,
      totalTasks: count(
        sql`case when ${taskGroupSql} is distinct from 'triage' then 1 end`,
      ),
      completedTasks: count(
        sql`case when ${taskGroupSql} = 'completed' or (${taskTable.archivedAt} is not null and ${taskGroupSql} in ('backlog', 'unstarted', 'started')) then 1 end`,
      ),
      cancelledTasks: count(
        sql`case when ${taskGroupSql} = 'cancelled' then 1 end`,
      ),
      // mapWith decodes like the column itself (stored as UTC wall time).
      dueDate:
        sql<Date | null>`min(case when ${taskTable.archivedAt} is null and ${taskGroupSql} in ('backlog', 'unstarted', 'started') then ${taskTable.dueDate} end)`.mapWith(
          taskTable.dueDate,
        ),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        // Trashed projects and tasks read as gone (C7).
        isNull(projectTable.deletedAt),
        isNull(taskTable.deletedAt),
        includeArchived ? undefined : isNull(projectTable.archivedAt),
      ),
    )
    .groupBy(taskTable.projectId);

  for (const row of rows) {
    const totalTasks = Number(row.totalTasks);

    statisticsByProject.set(row.projectId, {
      totalTasks,
      completionPercentage: progressPercent({
        completed: Number(row.completedTasks),
        cancelled: Number(row.cancelledTasks),
        visible: totalTasks,
      }),
      dueDate: row.dueDate ?? null,
    });
  }

  return statisticsByProject;
}

async function getProjects(workspaceId: string, includeArchived = false) {
  const projects = await db.query.projectTable.findMany({
    where: and(
      eq(projectTable.workspaceId, workspaceId),
      isNull(projectTable.deletedAt),
      includeArchived ? undefined : isNull(projectTable.archivedAt),
    ),
    // `id` is the deterministic tie-breaker: without it, rows sharing both a
    // position and a createdAt come back in an unspecified order.
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
  });

  const statisticsByProject = await getProjectStatistics(
    workspaceId,
    includeArchived,
  );

  return projects.map((project) => ({
    ...project,
    statistics: statisticsByProject.get(project.id) ?? EMPTY_STATISTICS,
    archivedTasks: [],
    plannedTasks: [],
    columns: [],
  }));
}

export default getProjects;
