import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import {
  columnTable,
  intakeItemTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import { escapeLikePattern } from "../search/like-pattern";
import { PLANNED_STATUS, taskColumnJoin, taskGroupSql } from "../task/scope";
import { formatTaskKey } from "../task-activity/task-snapshot";
import type { IntakeSearch, SubmitterFilter } from "./list-filters";
import {
  INTAKE_SOURCES,
  INTAKE_STATUSES,
  type IntakeSource,
  type IntakeStatus,
  isIntakeStatus,
} from "./status";

// SQL for intake reads (B7 §3.4). Every read, filter and count uses the
// effective status, so an expired snooze is pending without waiting for the
// wake-up job.

export const effectiveStatusSql = sql<IntakeStatus>`(case
  when ${intakeItemTable.status} = 'snoozed'
    and ${intakeItemTable.snoozedUntil} <= now() then 'pending'
  else ${intakeItemTable.status}
end)`;

const submitter = alias(userTable, "intake_submitter");
const triager = alias(userTable, "intake_triager");
const taskProject = alias(projectTable, "intake_task_project");
const duplicateTask = alias(taskTable, "intake_duplicate_task");
const duplicateProject = alias(projectTable, "intake_duplicate_project");

const itemSelection = {
  id: intakeItemTable.id,
  projectId: intakeItemTable.projectId,
  taskId: intakeItemTable.taskId,
  status: effectiveStatusSql,
  snoozedUntil: intakeItemTable.snoozedUntil,
  source: intakeItemTable.source,
  resolutionNote: intakeItemTable.resolutionNote,
  triagedAt: intakeItemTable.triagedAt,
  createdAt: intakeItemTable.createdAt,
  updatedAt: intakeItemTable.updatedAt,
  submitterId: submitter.id,
  submitterName: submitter.name,
  submitterImage: submitter.image,
  submitterEmail: intakeItemTable.submitterEmail,
  submitterExternalName: intakeItemTable.submitterName,
  triagerId: triager.id,
  triagerName: triager.name,
  triagerImage: triager.image,
  taskProjectId: taskTable.projectId,
  taskProjectSlug: taskProject.slug,
  taskNumber: taskTable.number,
  taskTitle: taskTable.title,
  taskPriority: taskTable.priority,
  taskStatus: taskTable.status,
  taskColumnId: taskTable.columnId,
  taskAssigneeId: taskTable.userId,
  taskDueDate: taskTable.dueDate,
  taskUpdatedAt: taskTable.updatedAt,
  columnName: columnTable.name,
  group: taskGroupSql,
  duplicateId: duplicateTask.id,
  duplicateNumber: duplicateTask.number,
  duplicateTitle: duplicateTask.title,
  duplicateStatus: duplicateTask.status,
  duplicateProjectSlug: duplicateProject.slug,
};

function selectItems() {
  return db
    .select(itemSelection)
    .from(intakeItemTable)
    .innerJoin(taskTable, eq(taskTable.id, intakeItemTable.taskId))
    .innerJoin(taskProject, eq(taskProject.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .leftJoin(submitter, eq(submitter.id, intakeItemTable.submittedBy))
    .leftJoin(triager, eq(triager.id, intakeItemTable.triagedBy))
    .leftJoin(
      duplicateTask,
      eq(duplicateTask.id, intakeItemTable.duplicateOfTaskId),
    )
    .leftJoin(
      duplicateProject,
      eq(duplicateProject.id, duplicateTask.projectId),
    );
}

type ItemRow = Awaited<ReturnType<typeof selectItems>>[number];

function person(id: string | null, name: string | null, image: string | null) {
  return id ? { id, name: name ?? "", image } : null;
}

/** The `IntakeItem` response of one joined row. */
export function toIntakeItem(row: ItemRow) {
  const status = isIntakeStatus(row.status) ? row.status : "pending";
  const planned = row.taskStatus === PLANNED_STATUS;
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    status,
    // An expired snooze reads as pending, without a date.
    snoozedUntil: status === "snoozed" ? row.snoozedUntil : null,
    source: (INTAKE_SOURCES as readonly string[]).includes(row.source)
      ? (row.source as IntakeSource)
      : "in_app",
    resolutionNote: row.resolutionNote,
    submittedBy: person(row.submitterId, row.submitterName, row.submitterImage),
    externalSubmitter:
      row.submitterEmail || row.submitterExternalName
        ? {
            email: row.submitterEmail,
            name: row.submitterExternalName,
          }
        : null,
    triagedBy: person(row.triagerId, row.triagerName, row.triagerImage),
    triagedAt: row.triagedAt,
    duplicateOf: row.duplicateId
      ? {
          taskId: row.duplicateId,
          key: formatTaskKey(
            row.duplicateProjectSlug ?? "",
            row.duplicateNumber,
          ),
          title: row.duplicateTitle ?? "",
          status: row.duplicateStatus ?? "",
        }
      : null,
    task: {
      id: row.taskId,
      projectId: row.taskProjectId,
      number: row.taskNumber ?? 0,
      key: formatTaskKey(row.taskProjectSlug, row.taskNumber),
      title: row.taskTitle,
      priority: row.taskPriority,
      status: row.taskStatus,
      columnId: row.taskColumnId,
      columnName: planned ? null : (row.columnName ?? null),
      group: row.group,
      assigneeId: row.taskAssigneeId,
      dueDate: row.taskDueDate,
      updatedAt: row.taskUpdatedAt,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type IntakeItemResponse = ReturnType<typeof toIntakeItem>;

export async function loadIntakeItem(
  id: string,
): Promise<IntakeItemResponse | null> {
  const [row] = await selectItems().where(eq(intakeItemTable.id, id)).limit(1);
  return row ? toIntakeItem(row) : null;
}

/** Several requests in one query, in no particular order. */
export async function loadIntakeItems(
  ids: readonly string[],
): Promise<IntakeItemResponse[]> {
  if (ids.length === 0) return [];
  const rows = await selectItems().where(inArray(intakeItemTable.id, [...ids]));
  return rows.map(toIntakeItem);
}

export async function loadIntakeItemByTask(
  taskId: string,
): Promise<IntakeItemResponse | null> {
  const [row] = await selectItems()
    .where(eq(intakeItemTable.taskId, taskId))
    .limit(1);
  return row ? toIntakeItem(row) : null;
}

export type IntakeListFilters = {
  projectId: string;
  statuses: readonly IntakeStatus[];
  priorities: readonly string[];
  /** Empty: every source. */
  sources?: readonly IntakeSource[];
  submitter: SubmitterFilter | { kind: "nobody" };
  search: IntakeSearch;
  sortBy: "createdAt" | "updatedAt" | "number";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
};

/** Filters shared by the page and the counts: everything but status. */
function baseConditions(filters: IntakeListFilters): SQL[] {
  const conditions: SQL[] = [
    eq(intakeItemTable.projectId, filters.projectId),
    // An accepted request whose task is in the trash reads as gone (C7).
    isNull(taskTable.deletedAt),
  ];

  if (filters.priorities.length > 0) {
    conditions.push(inArray(taskTable.priority, [...filters.priorities]));
  }

  if (filters.sources && filters.sources.length > 0) {
    conditions.push(inArray(intakeItemTable.source, [...filters.sources]));
  }

  if (filters.submitter.kind === "nobody") {
    conditions.push(sql`false`);
  } else if (filters.submitter.kind === "user") {
    conditions.push(eq(intakeItemTable.submittedBy, filters.submitter.userId));
  }

  const { search } = filters;
  if (search.kind !== "none") {
    const byTitle = ilike(
      taskTable.title,
      `%${escapeLikePattern(search.text)}%`,
    );
    const byNumber =
      search.kind === "number"
        ? eq(taskTable.number, search.number)
        : search.kind === "key"
          ? and(
              eq(taskTable.number, search.number),
              sql`lower(${taskProject.slug}) = lower(${search.slug})`,
            )
          : undefined;
    conditions.push(byNumber ? (or(byTitle, byNumber) as SQL) : byTitle);
  }

  return conditions;
}

function orderBy(filters: IntakeListFilters): SQL[] {
  const direction = filters.sortOrder === "asc" ? asc : desc;
  const primary =
    filters.sortBy === "number"
      ? sql`${taskTable.number}`
      : filters.sortBy === "updatedAt"
        ? // Task timestamps are stored as UTC without a zone.
          sql`greatest(${intakeItemTable.updatedAt}, ${taskTable.updatedAt} at time zone 'UTC')`
        : sql`${intakeItemTable.createdAt}`;
  return [direction(primary), direction(intakeItemTable.id)];
}

export type IntakeCounts = Record<IntakeStatus, number>;

function emptyCounts(): IntakeCounts {
  return Object.fromEntries(
    INTAKE_STATUSES.map((status) => [status, 0]),
  ) as IntakeCounts;
}

/** Effective-status counts under the base filters (tab and status ignored). */
export async function countIntakeItems(
  filters: Pick<
    IntakeListFilters,
    "projectId" | "priorities" | "submitter" | "search" | "sources"
  >,
): Promise<IntakeCounts> {
  const rows = await db
    .select({ status: effectiveStatusSql, total: count() })
    .from(intakeItemTable)
    .innerJoin(taskTable, eq(taskTable.id, intakeItemTable.taskId))
    .innerJoin(taskProject, eq(taskProject.id, taskTable.projectId))
    .where(
      and(
        ...baseConditions({
          ...filters,
          statuses: [],
          sortBy: "createdAt",
          sortOrder: "desc",
          page: 1,
          limit: 1,
        }),
      ),
    )
    .groupBy(effectiveStatusSql);

  const counts = emptyCounts();
  for (const row of rows) {
    if (isIntakeStatus(row.status)) counts[row.status] = Number(row.total);
  }
  return counts;
}

/** One page of the list plus the counts; `total` follows from the counts. */
export async function listIntakeItemPage(filters: IntakeListFilters) {
  const rows = await selectItems()
    .where(
      and(
        ...baseConditions(filters),
        inArray(effectiveStatusSql, [...filters.statuses]),
      ),
    )
    .orderBy(...orderBy(filters))
    .limit(filters.limit)
    .offset((filters.page - 1) * filters.limit);
  const counts = await countIntakeItems(filters);
  const total = filters.statuses.reduce(
    (sum, status) => sum + counts[status],
    0,
  );

  return {
    items: rows.map(toIntakeItem),
    page: filters.page,
    limit: filters.limit,
    total,
    hasMore: filters.page * filters.limit < total,
    counts,
  };
}
