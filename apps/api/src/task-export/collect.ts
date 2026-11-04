import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ColumnGroup } from "../column/groups";
import db from "../database";
import {
  columnTable,
  customFieldDefinitionTable,
  cycleTable,
  cycleTaskTable,
  projectTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import type { EstimateType } from "../estimate/types";
import { assigneesOfTasks } from "../task/assignees";
import {
  inTriageColumnSql,
  PLANNED_STATUS,
  taskColumnJoin,
  taskGroupSql,
} from "../task/scope";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { taskAttachmentCountSql } from "../task-attachment/counts";
import { textArray } from "../task-query/context";
import { subTaskCountSql } from "../task-query/order";
import {
  type ExportComment,
  type ExportFieldValue,
  type ExportRelation,
  type ExportUser,
  loadComments,
  loadCycleNames,
  loadEstimates,
  loadFieldValues,
  loadLabels,
  loadLinks,
  loadModules,
  loadRelationRows,
  loadSubscriberIds,
  loadTaskKeys,
  loadTimeLogged,
  loadUsers,
  relationsByTask,
} from "./related";
import { MAX_EXPORT_COMMENTS } from "./types";

// What an export reads: the tasks of the chosen projects that are on a
// board (never intake requests still in triage; drafts are never tasks),
// optionally without archived ones, in project order then task number,
// a page at a time, with everything a row shows.

export type ExportProject = {
  id: string;
  name: string;
  slug: string;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
  timeTrackingEnabled: boolean;
};

export type ExportCustomField = {
  projectId: string;
  name: string;
  type: string;
};

export type ExportTask = {
  id: string;
  project: ExportProject;
  key: string;
  number: number;
  parent: { id: string; key: string } | null;
  title: string;
  description: string;
  status: { slug: string; name: string };
  group: ColumnGroup;
  priority: string;
  assignees: ExportUser[];
  subscribers: { id: string; name: string }[];
  createdBy: { id: string; name: string } | null;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  estimate: { value: string; type: EstimateType } | null;
  labels: { name: string; color: string }[];
  cycle: { id: string; name: string } | null;
  modules: { id: string; name: string }[];
  links: { title: string | null; url: string }[];
  relations: ExportRelation[];
  comments: ExportComment[];
  commentsTruncated: boolean;
  subTaskCount: number;
  linkCount: number;
  attachmentCount: number;
  timeLoggedMinutes: number | null;
  customFields: ExportFieldValue[];
};

export const EXPORT_PAGE_SIZE = 500;

/** The tasks an export covers in these projects. */
export function exportScope(
  projectIds: readonly string[],
  includeArchived: boolean,
): SQL {
  return and(
    sql`${taskTable.projectId} = any(${textArray(projectIds)})`,
    sql`not ${inTriageColumnSql}`,
    // Trashed tasks read as gone (C7).
    isNull(taskTable.deletedAt),
    includeArchived ? undefined : isNull(taskTable.archivedAt),
  ) as SQL;
}

export async function countExportTasks(
  projectIds: readonly string[],
  includeArchived: boolean,
): Promise<number> {
  if (projectIds.length === 0) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(taskTable)
    .where(exportScope(projectIds, includeArchived));
  return row?.count ?? 0;
}

/** The workspace's projects among `projectIds` that still exist, in order. */
export async function loadExportProjects(
  workspaceId: string,
  projectIds: readonly string[],
): Promise<ExportProject[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      estimatesEnabled: projectTable.estimatesEnabled,
      timeTrackingEnabled: projectTable.timeTrackingEnabled,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        sql`${projectTable.id} = any(${textArray(projectIds)})`,
        isNull(projectTable.deletedAt),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return projectIds.flatMap((id) => byId.get(id) ?? []);
}

/** Field definitions of these projects, in project order then position. */
export async function loadCustomFieldDefinitions(
  projects: readonly ExportProject[],
): Promise<ExportCustomField[]> {
  if (projects.length === 0) return [];
  const rows = await db
    .select({
      projectId: customFieldDefinitionTable.projectId,
      name: customFieldDefinitionTable.name,
      type: customFieldDefinitionTable.type,
    })
    .from(customFieldDefinitionTable)
    .where(
      sql`${customFieldDefinitionTable.projectId} = any(${textArray(projects.map((project) => project.id))})`,
    )
    .orderBy(
      asc(customFieldDefinitionTable.position),
      asc(customFieldDefinitionTable.id),
    );
  const order = new Map(projects.map((project, index) => [project.id, index]));
  return rows.sort(
    (a, b) => (order.get(a.projectId) ?? 0) - (order.get(b.projectId) ?? 0),
  );
}

const exportMembership = alias(cycleTaskTable, "export_cycle_task");
const exportCycle = alias(cycleTable, "export_cycle");
const exportParent = alias(taskRelationTable, "export_parent");

const cycleIdSql = sql<string | null>`(
  select ${exportMembership.cycleId}
  from ${cycleTaskTable} as ${sql.identifier("export_cycle_task")}
  inner join ${cycleTable} as ${sql.identifier("export_cycle")}
    on ${exportCycle.id} = ${exportMembership.cycleId}
    and ${exportCycle.projectId} = ${taskTable.projectId}
  where ${exportMembership.taskId} = ${taskTable.id}
)`;

// The oldest subtask relation names the parent, as everywhere else.
const parentIdSql = sql<string | null>`(
  select ${exportParent.sourceTaskId}
  from ${taskRelationTable} as ${sql.identifier("export_parent")}
  where ${exportParent.targetTaskId} = ${taskTable.id}
    and ${exportParent.relationType} = 'subtask'
  order by ${exportParent.createdAt} asc, ${exportParent.id} asc
  limit 1
)`;

const numberKey = sql<number>`coalesce(${taskTable.number}, 0)`;

type Cursor = { number: number; id: string };

async function loadBaseRows(
  project: ExportProject,
  includeArchived: boolean,
  after: Cursor | null,
  limit: number,
) {
  return db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      columnName: columnTable.name,
      group: taskGroupSql,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      completedAt: taskTable.completedAt,
      createdAt: taskTable.createdAt,
      updatedAt: taskTable.updatedAt,
      archivedAt: taskTable.archivedAt,
      createdBy: taskTable.createdBy,
      estimatePointId: taskTable.estimatePointId,
      cycleId: cycleIdSql,
      parentId: parentIdSql,
      subTaskCount: sql<number>`${subTaskCountSql}`.mapWith(Number),
      attachmentCount: taskAttachmentCountSql,
    })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        exportScope([project.id], includeArchived),
        after
          ? sql`(${numberKey}, ${taskTable.id}) > (${after.number}::integer, ${after.id}::text)`
          : undefined,
      ),
    )
    .orderBy(asc(numberKey), asc(taskTable.id))
    .limit(limit);
}

type BaseRow = Awaited<ReturnType<typeof loadBaseRows>>[number];

async function hydratePage(
  workspaceId: string,
  project: ExportProject,
  rows: BaseRow[],
  hiddenProjectIds: readonly string[],
  maxComments: number | null,
): Promise<ExportTask[]> {
  const ids = rows.map((row) => row.id);
  const [assignees, labels, subscribers, links, relationRows, comments] =
    await Promise.all([
      assigneesOfTasks(ids),
      loadLabels(workspaceId, ids),
      loadSubscriberIds(ids),
      loadLinks(ids),
      loadRelationRows(ids),
      loadComments(ids, maxComments),
    ]);
  const modules = project.modulesEnabled
    ? await loadModules(ids)
    : new Map<string, { id: string; name: string }[]>();
  const cycles = project.cyclesEnabled
    ? await loadCycleNames(rows.flatMap((row) => row.cycleId ?? []))
    : new Map<string, string>();
  const estimates = project.estimatesEnabled
    ? await loadEstimates(rows.flatMap((row) => row.estimatePointId ?? []))
    : new Map<string, { value: string; type: EstimateType }>();
  const timeLogged = project.timeTrackingEnabled
    ? await loadTimeLogged(ids)
    : null;
  const fieldValues = await loadFieldValues(ids);

  const otherTaskIds = [
    ...rows.flatMap((row) => row.parentId ?? []),
    ...relationRows.flatMap((row) => [row.sourceTaskId, row.targetTaskId]),
  ];
  const keys = await loadTaskKeys(otherTaskIds, workspaceId, hiddenProjectIds);
  const relations = relationsByTask(ids, relationRows, keys);

  const users = await loadUsers([
    ...[...assignees.values()].flat(),
    ...[...subscribers.values()].flat(),
    ...rows.flatMap((row) => row.createdBy ?? []),
  ]);
  const person = (id: string) => {
    const user = users.get(id);
    return user ? { id: user.id, name: user.name } : null;
  };

  return rows.map((row) => {
    const taskLinks = links.get(row.id) ?? [];
    const cycleName = row.cycleId ? cycles.get(row.cycleId) : undefined;
    const estimate = row.estimatePointId
      ? estimates.get(row.estimatePointId)
      : undefined;
    const parentKey = row.parentId ? keys.get(row.parentId) : undefined;
    return {
      id: row.id,
      project,
      key: formatTaskKey(project.slug, row.number),
      number: row.number ?? 0,
      parent:
        row.parentId && parentKey ? { id: row.parentId, key: parentKey } : null,
      title: row.title,
      description: row.description ?? "",
      status: {
        slug: row.status,
        name:
          row.status === PLANNED_STATUS
            ? "Backlog"
            : (row.columnName ?? row.status),
      },
      group: row.group,
      priority: row.priority,
      assignees: (assignees.get(row.id) ?? []).flatMap(
        (id) => users.get(id) ?? [],
      ),
      subscribers: (subscribers.get(row.id) ?? []).flatMap(
        (id) => person(id) ?? [],
      ),
      createdBy: row.createdBy ? person(row.createdBy) : null,
      startDate: row.startDate,
      dueDate: row.dueDate,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
      estimate: estimate ?? null,
      labels: labels.get(row.id) ?? [],
      cycle:
        row.cycleId && cycleName ? { id: row.cycleId, name: cycleName } : null,
      modules: modules.get(row.id) ?? [],
      links: taskLinks,
      relations: relations.get(row.id) ?? [],
      comments: comments.comments.get(row.id) ?? [],
      commentsTruncated: comments.truncated.has(row.id),
      subTaskCount: row.subTaskCount,
      // The same links the Links column lists: user and integration links.
      linkCount: taskLinks.length,
      attachmentCount: row.attachmentCount,
      timeLoggedMinutes: timeLogged ? (timeLogged.get(row.id) ?? 0) : null,
      customFields: fieldValues.get(row.id) ?? [],
    };
  });
}

/**
 * One project's exported tasks, a page at a time, by task number. Relations
 * and parents in `hiddenProjectIds`, the projects hidden from the requester,
 * are left out. Comments per task are capped at `maxComments`; null keeps them
 * all.
 */
export async function* exportTaskPages(
  workspaceId: string,
  project: ExportProject,
  includeArchived: boolean,
  hiddenProjectIds: readonly string[],
  pageSize = EXPORT_PAGE_SIZE,
  maxComments: number | null = MAX_EXPORT_COMMENTS,
): AsyncGenerator<ExportTask[]> {
  let after: Cursor | null = null;
  for (;;) {
    const rows = await loadBaseRows(project, includeArchived, after, pageSize);
    if (rows.length === 0) return;
    yield await hydratePage(
      workspaceId,
      project,
      rows,
      hiddenProjectIds,
      maxComments,
    );
    if (rows.length < pageSize) return;
    const last = rows[rows.length - 1] as BaseRow;
    after = { number: last.number ?? 0, id: last.id };
  }
}
