import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  cycleTable,
  moduleTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { featureDisabledMessage } from "../../project/features";
import { escapeLikePattern } from "../../search/like-pattern";
import { inTriageColumnSql, liveTaskCondition } from "../../task/scope";
import { type ArchivedEntityType, DEFAULT_ARCHIVE_PAGE_SIZE } from "../schema";
import type { ArchiveScope } from "../scope";

type Paging = { search?: string; page?: number; limit?: number };

const projectFields = {
  projectId: projectTable.id,
  projectName: projectTable.name,
  projectSlug: projectTable.slug,
  projectIcon: projectTable.icon,
};

const countValue = sql<number>`count(*)::int`;

function nameFilter(column: AnyPgColumn, search?: string) {
  return search ? ilike(column, `%${escapeLikePattern(search)}%`) : undefined;
}

async function page<T>(
  rows: PromiseLike<T[]>,
  total: PromiseLike<{ value: number }[]>,
  paging: Required<Paging>,
) {
  const [pageRows, [count]] = await Promise.all([rows, total]);
  const value = count?.value ?? 0;
  return {
    rows: pageRows,
    total: value,
    page: paging.page,
    limit: paging.limit,
    hasMore: paging.page * paging.limit < value,
  };
}

function forbidden(message: string): never {
  throw new HTTPException(403, { message });
}

async function listCycles(scope: ArchiveScope, paging: Required<Paging>) {
  if (!scope.can.cycleRead) forbidden("Insufficient permissions");
  if (scope.projectId && !scope.cyclesOn) {
    forbidden(featureDisabledMessage("cycles"));
  }
  const where = and(
    scope.projects,
    eq(projectTable.cyclesEnabled, true),
    isNotNull(cycleTable.archivedAt),
    nameFilter(cycleTable.name, paging.search),
  );
  const rows = db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      archivedAt: cycleTable.archivedAt,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      ownerId: cycleTable.ownerId,
      ...projectFields,
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(where)
    .orderBy(
      desc(cycleTable.archivedAt),
      asc(sql`lower(${cycleTable.name})`),
      asc(cycleTable.id),
    )
    .limit(paging.limit)
    .offset((paging.page - 1) * paging.limit);
  const total = db
    .select({ value: countValue })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(where);

  const result = await page(rows, total, paging);
  const { can, userId } = scope;
  return {
    ...result,
    items: result.rows.map(
      ({ startDate, endDate, ownerId, archivedAt, ...row }) => ({
        type: "cycle" as const,
        ...row,
        archivedAt: archivedAt as Date,
        details: { startDate, endDate },
        canRestore: can.cycleUpdate,
        canDelete: can.cycleDelete || (can.cycleUpdate && ownerId === userId),
      }),
    ),
  };
}

async function listModules(scope: ArchiveScope, paging: Required<Paging>) {
  if (!scope.can.moduleRead) forbidden("Insufficient permissions");
  if (scope.projectId && !scope.modulesOn) {
    forbidden(featureDisabledMessage("modules"));
  }
  const where = and(
    scope.projects,
    eq(projectTable.modulesEnabled, true),
    isNotNull(moduleTable.archivedAt),
    nameFilter(moduleTable.name, paging.search),
  );
  const rows = db
    .select({
      id: moduleTable.id,
      name: moduleTable.name,
      archivedAt: moduleTable.archivedAt,
      status: moduleTable.status,
      targetDate: moduleTable.targetDate,
      createdBy: moduleTable.createdBy,
      ...projectFields,
    })
    .from(moduleTable)
    .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
    .where(where)
    .orderBy(
      desc(moduleTable.archivedAt),
      asc(sql`lower(${moduleTable.name})`),
      asc(moduleTable.id),
    )
    .limit(paging.limit)
    .offset((paging.page - 1) * paging.limit);
  const total = db
    .select({ value: countValue })
    .from(moduleTable)
    .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
    .where(where);

  const result = await page(rows, total, paging);
  const { can, userId } = scope;
  return {
    ...result,
    items: result.rows.map(
      ({ status, targetDate, createdBy, archivedAt, ...row }) => ({
        type: "module" as const,
        ...row,
        archivedAt: archivedAt as Date,
        details: { status, targetDate },
        canRestore: can.moduleUpdate,
        canDelete:
          can.moduleDelete || (can.moduleUpdate && createdBy === userId),
      }),
    ),
  };
}

/** Every task but triage, archived included, of each listed project. */
async function taskCounts(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ projectId: taskTable.projectId, value: countValue })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.projectId, projectIds),
        liveTaskCondition,
        sql`not ${inTriageColumnSql}`,
      ),
    )
    .groupBy(taskTable.projectId);
  return new Map(rows.map((row) => [row.projectId, row.value]));
}

async function listProjects(scope: ArchiveScope, paging: Required<Paging>) {
  if (scope.projectId) {
    throw new HTTPException(400, {
      message: "Projects can't be listed inside a project",
    });
  }
  const where = and(
    eq(projectTable.workspaceId, scope.workspaceId),
    isNotNull(projectTable.archivedAt),
    isNull(projectTable.deletedAt),
    nameFilter(projectTable.name, paging.search),
  ) as SQL;
  const rows = db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      archivedAt: projectTable.archivedAt,
      ...projectFields,
    })
    .from(projectTable)
    .where(where)
    .orderBy(
      desc(projectTable.archivedAt),
      asc(sql`lower(${projectTable.name})`),
      asc(projectTable.id),
    )
    .limit(paging.limit)
    .offset((paging.page - 1) * paging.limit);
  const total = db
    .select({ value: countValue })
    .from(projectTable)
    .where(where);

  const result = await page(rows, total, paging);
  const counts = await taskCounts(result.rows.map((row) => row.id));
  return {
    ...result,
    items: result.rows.map(({ archivedAt, ...row }) => ({
      type: "project" as const,
      ...row,
      archivedAt: archivedAt as Date,
      details: { taskCount: counts.get(row.id) ?? 0 },
      canRestore: scope.can.projectUpdate,
      canDelete: scope.can.projectDelete,
    })),
  };
}

/** One page of archived cycles, modules or projects, newest archive first. */
export async function listArchived(
  scope: ArchiveScope,
  type: ArchivedEntityType,
  { search, page: pageNumber = 1, limit = DEFAULT_ARCHIVE_PAGE_SIZE }: Paging,
) {
  const paging = { search: search ?? "", page: pageNumber, limit };
  const result =
    type === "cycle"
      ? await listCycles(scope, paging)
      : type === "module"
        ? await listModules(scope, paging)
        : await listProjects(scope, paging);
  return {
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
  };
}
