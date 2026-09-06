import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  estimatePointTable,
  externalLinkTable,
  labelTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";

import { assigneeDetailsOfTasks, hasAnyAssignee } from "../assignees";
import { boundedTaskRead, type TaskReadDatabase } from "../bounded-read";
import {
  boardDescription,
  boardProjectDescription,
  descriptionDeferred,
  projectDescriptionDeferred,
} from "../description-pages";
import {
  ARCHIVED_STATUS,
  inTriageColumnSql,
  liveTaskCondition,
} from "../scope";

export type GetTasksOptions = {
  assigneeId?: string;
  dueAfter?: string;
  dueBefore?: string;
  limit?: number;
  page?: number;
  relatedPage?: number;
  priority?: string;
  sortBy?:
    | "createdAt"
    | "priority"
    | "dueDate"
    | "position"
    | "title"
    | "number"
    | "estimate";
  sortOrder?: "asc" | "desc";
  status?: string;
  /** Comma-separated point ids; `none` matches tasks without an estimate. */
  estimatePointId?: string;
};

const priorityCaseExpr = sql<number>`CASE
  WHEN ${taskTable.priority} = 'urgent' THEN 4
  WHEN ${taskTable.priority} = 'high' THEN 3
  WHEN ${taskTable.priority} = 'medium' THEN 2
  WHEN ${taskTable.priority} = 'low' THEN 1
  ELSE 0
END`;

// A subquery rather than a join keeps the board query unchanged unless the
// estimate sort is asked for.
const estimatePositionExpr = sql<number | null>`(
  select ${estimatePointTable.position} from ${estimatePointTable}
  where ${estimatePointTable.id} = ${taskTable.estimatePointId}
)`;

function buildOrderBy(
  sortBy: GetTasksOptions["sortBy"],
  sortOrder: GetTasksOptions["sortOrder"],
): SQL {
  const direction = sortOrder === "desc" ? desc : asc;

  switch (sortBy) {
    case "createdAt":
      return direction(taskTable.createdAt);
    case "priority":
      return direction(priorityCaseExpr);
    case "dueDate":
      return direction(taskTable.dueDate);
    case "title":
      return direction(taskTable.title);
    case "number":
      return direction(taskTable.number);
    case "estimate":
      // Tasks without an estimate come last whichever way the sort runs.
      return sortOrder === "desc"
        ? sql`${estimatePositionExpr} desc nulls last`
        : sql`${estimatePositionExpr} asc nulls last`;
    default:
      return direction(taskTable.position);
  }
}

/** The size of the whole filtered set, on every row of a limited page. */
const windowTotal = sql<number>`count(*) over ()`.mapWith(Number);

/**
 * A collection's total from a page selected with `windowTotal`. An empty page
 * carries no row to read it from: at offset 0 the total is 0, past the end it
 * takes the fallback count.
 */
async function totalOf(
  rows: readonly { total: number }[],
  offset: number,
  count: () => Promise<number | string | undefined>,
): Promise<number> {
  const [first] = rows;
  if (first) return Number(first.total);
  if (offset === 0) return 0;
  return Number((await count()) ?? 0);
}

/** The estimate filter: any of the listed points, or none with `none`. */
function estimateFilter(value: string): SQL | undefined {
  const ids = [
    ...new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  const pointIds = ids.filter((id) => id !== "none");
  const withNone = ids.includes("none");
  const conditions = [
    pointIds.length > 0 ? inArray(taskTable.estimatePointId, pointIds) : null,
    withNone ? isNull(taskTable.estimatePointId) : null,
  ].filter((condition): condition is SQL => condition !== null);
  return conditions.length > 0 ? or(...conditions) : undefined;
}

async function getTasksPage(
  db: TaskReadDatabase,
  projectId: string,
  options: GetTasksOptions,
) {
  const [project] = await db
    .select({
      ...getTableColumns(projectTable),
      description: boardProjectDescription,
      descriptionDeferred: projectDescriptionDeferred,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  // Triage belongs to intake: its columns and their tasks stay off the board.
  const conditions = [
    eq(taskTable.projectId, projectId),
    liveTaskCondition,
    sql`not ${inTriageColumnSql}`,
  ];

  // D7: archived tasks keep their column. The legacy status filter
  // "archived" means archived tasks; a column's slug means the tasks in it
  // that are not archived, as before.
  if (options.status === ARCHIVED_STATUS) {
    conditions.push(isNotNull(taskTable.archivedAt));
  } else if (options.status) {
    conditions.push(
      eq(taskTable.status, options.status),
      isNull(taskTable.archivedAt),
    );
  }

  if (options.priority) {
    conditions.push(eq(taskTable.priority, options.priority));
  }

  if (options.assigneeId) {
    conditions.push(hasAnyAssignee([options.assigneeId]));
  }

  if (options.dueBefore) {
    conditions.push(lte(taskTable.dueDate, new Date(options.dueBefore)));
  }

  if (options.dueAfter) {
    conditions.push(gte(taskTable.dueDate, new Date(options.dueAfter)));
  }

  if (options.estimatePointId) {
    const condition = estimateFilter(options.estimatePointId);
    if (condition) conditions.push(condition);
  }

  const whereClause = and(...conditions);
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;
  const relatedPage = options.relatedPage ?? 1;
  const relatedPageSize = 100;
  const relatedOffset = (relatedPage - 1) * relatedPageSize;

  const orderByClause = buildOrderBy(
    options.sortBy ?? "position",
    options.sortOrder ?? "asc",
  );

  const taskSelection = {
    id: taskTable.id,
    title: taskTable.title,
    number: taskTable.number,
    description: boardDescription,
    descriptionDeferred,
    status: taskTable.status,
    priority: taskTable.priority,
    startDate: taskTable.startDate,
    dueDate: taskTable.dueDate,
    position: taskTable.position,
    createdAt: taskTable.createdAt,
    archivedAt: taskTable.archivedAt,
    createdBy: taskTable.createdBy,
    userId: taskTable.userId,
    assigneeName: userTable.name,
    assigneeId: userTable.id,
    assigneeImage: userTable.image,
    projectId: taskTable.projectId,
    cycleId: cycleTable.id,
    estimatePointId: taskTable.estimatePointId,
  };

  // The totals ride along as window counts (taken before LIMIT/OFFSET), so a
  // page costs one statement per collection instead of two; a separate count
  // runs only for a page past the end. Each board load is dozens of pages.
  const query = db
    .select({ ...taskSelection, total: windowTotal })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(cycleTaskTable, eq(cycleTaskTable.taskId, taskTable.id))
    .leftJoin(
      cycleTable,
      and(
        eq(cycleTable.id, cycleTaskTable.cycleId),
        eq(cycleTable.projectId, taskTable.projectId),
      ),
    )
    .where(whereClause)
    .orderBy(orderByClause, asc(taskTable.id));

  const pageWithTotals = await query.limit(pageSize).offset(offset);
  const total = await totalOf(pageWithTotals, offset, async () => {
    const [taskCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(taskTable)
      .where(whereClause);
    return taskCount?.count;
  });
  const pageRows = pageWithTotals.map(({ total: _total, ...row }) => row);
  // Assignees are never split across related pages: at most 20 per task.
  const assigneesByTask = await assigneeDetailsOfTasks(
    pageRows.map((task) => task.id),
    db,
  );

  // With the cycles feature off, tasks read as in no cycle; memberships stay.
  const paginatedTasks = pageRows.map((row) => {
    const assignees = assigneesByTask.get(row.id) ?? [];
    const task = {
      ...row,
      assigneeIds: assignees.map((assignee) => assignee.id),
      assignees,
    };
    return project.cyclesEnabled ? task : { ...task, cycleId: null };
  });

  const taskIds = paginatedTasks.map((task) => task.id);

  const labelsWithTotals =
    taskIds.length > 0
      ? await db
          .select({
            id: labelTable.id,
            name: labelTable.name,
            color: labelTable.color,
            taskId: labelTable.taskId,
            total: windowTotal,
          })
          .from(labelTable)
          .where(inArray(labelTable.taskId, taskIds))
          .orderBy(asc(labelTable.id))
          .limit(relatedPageSize)
          .offset(relatedOffset)
      : [];
  const labelsData = labelsWithTotals.map(
    ({ total: _total, ...label }) => label,
  );

  const linksWithTotals =
    taskIds.length > 0
      ? await db
          .select({ ...getTableColumns(externalLinkTable), total: windowTotal })
          .from(externalLinkTable)
          .where(inArray(externalLinkTable.taskId, taskIds))
          .orderBy(asc(externalLinkTable.id))
          .limit(relatedPageSize)
          .offset(relatedOffset)
      : [];
  const externalLinksData = linksWithTotals.map(
    ({ total: _total, ...link }) => link,
  );

  const taskLabelsMap = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (label.taskId) {
      if (!taskLabelsMap.has(label.taskId)) {
        taskLabelsMap.set(label.taskId, []);
      }
      taskLabelsMap.get(label.taskId)?.push({
        id: label.id,
        name: label.name,
        color: label.color,
      });
    }
  }

  const taskExternalLinksMap = new Map<
    string,
    Array<{
      id: string;
      taskId: string;
      integrationId: string;
      resourceType: string;
      externalId: string;
      url: string;
      title: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  >();
  for (const externalLink of externalLinksData) {
    if (!taskExternalLinksMap.has(externalLink.taskId)) {
      taskExternalLinksMap.set(externalLink.taskId, []);
    }
    taskExternalLinksMap.get(externalLink.taskId)?.push({
      ...externalLink,
      metadata: parseMetadata(externalLink.metadata),
    });
  }

  const boardColumnCondition = and(
    eq(columnTable.projectId, projectId),
    ne(columnTable.group, "triage"),
  );

  const columnsWithTotals = await db
    .select({ ...getTableColumns(columnTable), total: windowTotal })
    .from(columnTable)
    .where(boardColumnCondition)
    .orderBy(asc(columnTable.position), asc(columnTable.id))
    .limit(relatedPageSize)
    .offset(relatedOffset);
  const projectColumns = columnsWithTotals.map(
    ({ total: _total, ...column }) => column,
  );

  // Keep every selected task representable even when its column falls on a
  // later metadata page. At most 100 distinct task statuses can be present.
  const missingStatuses = Array.from(
    new Set(paginatedTasks.map((task) => task.status)),
  ).filter(
    (status) =>
      status !== "planned" &&
      status !== ARCHIVED_STATUS &&
      !projectColumns.some((column) => column.slug === status),
  );
  if (missingStatuses.length) {
    const taskColumns = await db
      .selectDistinctOn([columnTable.slug])
      .from(columnTable)
      .where(
        and(boardColumnCondition, inArray(columnTable.slug, missingStatuses)),
      )
      .orderBy(
        asc(columnTable.slug),
        asc(columnTable.position),
        asc(columnTable.id),
      )
      .limit(100);
    projectColumns.push(...taskColumns);
  }
  const columnCount = await totalOf(
    columnsWithTotals,
    relatedOffset,
    async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(columnTable)
        .where(boardColumnCondition);
      return row?.count;
    },
  );
  let labelCount = 0;
  let linkCount = 0;
  if (taskIds.length) {
    labelCount = await totalOf(labelsWithTotals, relatedOffset, async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(labelTable)
        .where(inArray(labelTable.taskId, taskIds));
      return row?.count;
    });
    linkCount = await totalOf(linksWithTotals, relatedOffset, async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(externalLinkTable)
        .where(inArray(externalLinkTable.taskId, taskIds));
      return row?.count;
    });
  }

  const columns = projectColumns.map((column) => ({
    id: column.slug,
    slug: column.slug,
    name: column.name,
    position: column.position,
    icon: column.icon,
    group: column.group,
    isFinal: column.isFinal,
    tasks: paginatedTasks
      .filter((task) => task.status === column.slug && !task.archivedAt)
      .map((task) => ({
        ...task,
        labels: taskLabelsMap.get(task.id) || [],
        externalLinks: taskExternalLinksMap.get(task.id) || [],
      })),
  }));

  // Archived tasks of any column appear only here.
  const archivedTasks = paginatedTasks
    .filter((task) => task.archivedAt !== null)
    .map((task) => ({
      ...task,
      labels: taskLabelsMap.get(task.id) || [],
      externalLinks: taskExternalLinksMap.get(task.id) || [],
    }));

  const plannedTasks = paginatedTasks
    .filter((task) => task.status === "planned" && !task.archivedAt)
    .map((task) => ({
      ...task,
      labels: taskLabelsMap.get(task.id) || [],
      externalLinks: taskExternalLinksMap.get(task.id) || [],
    }));

  return {
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      description: project.description,
      descriptionDeferred: project.descriptionDeferred,
      isPublic: project.isPublic,
      workspaceId: project.workspaceId,
      columns,
      archivedTasks,
      plannedTasks,
    },
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      relatedPage,
      relatedPageSize,
      relatedTotalPages: Math.max(
        1,
        Math.ceil(
          Math.max(columnCount, labelCount, linkCount) / relatedPageSize,
        ),
      ),
    },
  };
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export default function getTasks(
  projectId: string,
  options: GetTasksOptions = {},
) {
  return boundedTaskRead(
    (db) => getTasksPage(db, projectId, options),
    "Task list request took too long; retry later",
  );
}
