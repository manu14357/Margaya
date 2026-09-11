import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskDraftTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import { DEFAULT_DRAFT_PAGE_SIZE } from "../schema";
import {
  DRAFT_NOT_FOUND,
  draftResponse,
  loadDraftProjects,
  ownDrafts,
  toTaskDraftSummary,
} from "./shared";

const { description: _description, ...summaryColumns } =
  getTableColumns(taskDraftTable);

/** One page of the caller's drafts in a workspace, newest edit first. */
export async function listTaskDrafts({
  userId,
  workspaceId,
  projectId,
  search,
  page = 1,
  limit = DEFAULT_DRAFT_PAGE_SIZE,
}: {
  userId: string;
  workspaceId: string;
  projectId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const conditions: (SQL | undefined)[] = [ownDrafts(userId, workspaceId)];
  if (projectId === "none") {
    conditions.push(isNull(taskDraftTable.projectId));
  } else if (projectId) {
    conditions.push(eq(taskDraftTable.projectId, projectId));
  }
  if (search) {
    conditions.push(
      ilike(taskDraftTable.title, `%${escapeLikePattern(search)}%`),
    );
  }
  const where = and(...conditions);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        ...summaryColumns,
        hasDescription: sql<boolean>`(${taskDraftTable.description} <> '')`,
      })
      .from(taskDraftTable)
      .where(where)
      .orderBy(desc(taskDraftTable.updatedAt), asc(taskDraftTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(taskDraftTable).where(where),
  ]);

  const projects = await loadDraftProjects(rows.map((row) => row.projectId));
  const totalCount = total?.value ?? 0;
  return {
    drafts: rows.map((row) => toTaskDraftSummary(row, projects)),
    total: totalCount,
    page,
    limit,
    hasMore: page * limit < totalCount,
  };
}

export async function countTaskDrafts(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(taskDraftTable)
    .where(ownDrafts(userId, workspaceId));
  return { count: row?.value ?? 0 };
}

/** The caller's draft; access.ts already refused everyone else. */
export async function getTaskDraft(draftId: string, userId: string) {
  const [row] = await db
    .select()
    .from(taskDraftTable)
    .where(
      and(eq(taskDraftTable.id, draftId), eq(taskDraftTable.createdBy, userId)),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: DRAFT_NOT_FOUND });
  return draftResponse(row);
}
