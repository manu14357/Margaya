import {
  and,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { projectVisibleSql } from "../../project/visibility";
import { workspacePermissionChecker } from "../../utils/require-workspace-permission";
import { isWorkspacePendingDeletion } from "../../workspace-deletion/lock";
import {
  canSeePage,
  depthOf,
  PAGE_MESSAGES,
  type PageCaller,
  type ParentMap,
  pageCapabilities,
} from "../rules";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Pick<Transaction, "select">;

export type PageRecord = typeof pageTable.$inferSelect;

/** Every page column except the content. */
const {
  contentYjs: _contentYjs,
  contentMarkdown: _contentMarkdown,
  contentText: _contentText,
  ...summaryColumns
} = getTableColumns(pageTable);

export const pageSummaryColumns = summaryColumns;

export type PageSummaryRecord = Omit<
  PageRecord,
  "contentYjs" | "contentMarkdown" | "contentText"
>;

/**
 * The caller's page permissions, read once per request. A workspace pending
 * deletion is read-only, so nobody may create or edit (this also keeps page
 * sockets from writing).
 */
export async function pageCallerOf(c: Context): Promise<PageCaller> {
  const workspaceId = c.get("workspaceId") as string | undefined;
  const [can, locked] = await Promise.all([
    workspacePermissionChecker(c),
    workspaceId ? isWorkspacePendingDeletion(workspaceId) : false,
  ]);
  return {
    userId: c.get("userId"),
    canRead: can({ page: ["read"] }),
    canCreate: !locked && can({ page: ["create"] }),
    canUpdate: !locked && can({ page: ["update"] }),
    isManager: can({ page: ["delete"] }),
  };
}

/** SQL twin of `canSeePage` (the caller's page:read is checked by the route). */
export function visiblePageCondition(caller: PageCaller): SQL {
  const conditions = [
    eq(pageTable.access, "public"),
    eq(pageTable.ownerId, caller.userId),
  ];
  if (caller.isManager) conditions.push(isNull(pageTable.ownerId));
  // Pages of a restricted project the caller cannot see stay hidden.
  return and(
    or(...conditions),
    projectVisibleSql(pageTable.projectId, caller.userId),
  ) as SQL;
}

/** Parent of every page in the project (all pages, visible or not). */
export async function projectParentMap(
  reader: Reader,
  projectId: string,
): Promise<Map<string, string | null>> {
  const rows = await reader
    .select({ id: pageTable.id, parentId: pageTable.parentId })
    .from(pageTable)
    .where(eq(pageTable.projectId, projectId));
  return new Map(rows.map((row) => [row.id, row.parentId]));
}

export function toPageSummary(
  row: PageSummaryRecord,
  caller: PageCaller,
  parentOf: ParentMap,
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    parentId: row.parentId,
    position: row.position,
    title: row.title,
    logoKind: row.logoKind,
    logoValue: row.logoValue,
    access: row.access,
    ownerId: row.ownerId,
    isLocked: row.isLocked,
    lockedById: row.lockedById,
    lockedAt: row.lockedAt,
    archivedAt: row.archivedAt,
    isFullWidth: row.isFullWidth,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    capabilities: pageCapabilities(
      { ...row, depth: depthOf(row.id, parentOf) },
      caller,
    ),
  };
}

export type PageSummaryResponse = ReturnType<typeof toPageSummary>;

/**
 * The page row, or 404 when it is missing or the caller can't see it.
 * `forUpdate` locks the row for the rest of the transaction.
 */
export async function loadVisiblePage(
  reader: Transaction | typeof db,
  pageId: string,
  caller: PageCaller,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<PageRecord> {
  const query = reader
    .select()
    .from(pageTable)
    .where(eq(pageTable.id, pageId))
    .limit(1);
  const [page] = forUpdate ? await query.for("update") : await query;
  if (!page || !canSeePage(page, caller)) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
  }
  return page;
}

/** The Page response: the summary plus content and visible ancestors. */
export async function getPageResponse(
  pageId: string,
  caller: PageCaller,
  reader: Transaction | typeof db = db,
) {
  const page = await loadVisiblePage(reader, pageId, caller);
  const parentOf = page.projectId
    ? await projectParentMap(reader, page.projectId)
    : new Map<string, string | null>([[page.id, page.parentId]]);

  const ancestorIds: string[] = [];
  const seen = new Set([page.id]);
  let current = page.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    ancestorIds.unshift(current);
    current = parentOf.get(current) ?? null;
  }
  const ancestors =
    ancestorIds.length > 0
      ? await reader
          .select({
            id: pageTable.id,
            title: pageTable.title,
            logoKind: pageTable.logoKind,
            logoValue: pageTable.logoValue,
            access: pageTable.access,
            ownerId: pageTable.ownerId,
          })
          .from(pageTable)
          .where(
            and(
              inArray(pageTable.id, ancestorIds),
              eq(pageTable.workspaceId, page.workspaceId),
            ),
          )
      : [];
  const byId = new Map(ancestors.map((row) => [row.id, row]));

  return {
    ...toPageSummary(page, caller, parentOf),
    contentMarkdown: page.contentMarkdown,
    contentVersion: page.contentVersion,
    ancestors: ancestorIds
      .map((id) => byId.get(id))
      .filter(
        (row): row is NonNullable<typeof row> =>
          row !== undefined && canSeePage(row, caller),
      )
      .map(({ id, title, logoKind, logoValue }) => ({
        id,
        title,
        logoKind,
        logoValue,
      })),
  };
}

export type PageResponse = Awaited<ReturnType<typeof getPageResponse>>;

/**
 * Serializes structural changes (create, tree moves, restore placement,
 * duplicate, moves between projects) per project for the transaction.
 * Stronger than a per-sibling-group lock: it also rules out cycles from two
 * concurrent moves in different groups.
 */
export async function lockPageTree(tx: Transaction, projectId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`page_tree:${projectId}`}))`,
  );
}

export function pageEventPayload(
  page: Pick<PageRecord, "id" | "projectId" | "workspaceId">,
  userId: string,
) {
  return {
    pageId: page.id,
    projectId: page.projectId,
    workspaceId: page.workspaceId,
    userId,
  };
}
