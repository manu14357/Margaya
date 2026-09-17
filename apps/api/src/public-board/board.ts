import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  activityTable,
  columnTable,
  projectPublicationTable,
  projectTable,
  publicBoardBlockTable,
  taskTable,
  workspaceUserTable,
} from "../database/schema";
import { settingsOf } from "../publication/settings";
import { isLinkTokenFormat } from "../publication/token";
import { projectDescriptionDeferred } from "../task/description-pages";
import { inTriageColumnSql, PLANNED_STATUS } from "../task/scope";
import { publicBoardInstanceState } from "./instance-state";
import type { PublicViewer, ResolvedBoard } from "./types";

// Resolves a link token to a live board (B12 §3.5). Unknown, unpublished,
// archived and switched-off boards all answer the same 404.

export const BOARD_NOT_FOUND =
  "This board doesn't exist or is no longer public";
export const TASK_NOT_ON_BOARD = "This task isn't on the board";
export const COMMENT_NOT_FOUND = "Comment not found";

const MAX_TASK_NUMBER = 2 ** 31 - 1;

function notFound(message = BOARD_NOT_FOUND): never {
  throw new HTTPException(404, { message });
}

export async function resolveBoard(
  token: string,
  viewerUserId: string | null,
): Promise<ResolvedBoard> {
  // The format is checked before any query.
  if (!isLinkTokenFormat(token)) notFound();
  const instance = await publicBoardInstanceState();
  if (!instance.publicBoards) notFound();

  const viewer = viewerUserId ?? "";
  const [row] = await db
    .select({
      publication: projectPublicationTable,
      workspaceId: projectTable.workspaceId,
      name: projectTable.name,
      slug: projectTable.slug,
      icon: projectTable.icon,
      description: sql<
        string | null
      >`case when ${projectDescriptionDeferred} then null else ${projectTable.description} end`,
      descriptionDeferred: projectDescriptionDeferred,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
      intakeEnabled: projectTable.intakeEnabled,
      memberId: workspaceUserTable.userId,
      blockedId: publicBoardBlockTable.userId,
    })
    .from(projectPublicationTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, projectPublicationTable.projectId),
    )
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, viewer),
      ),
    )
    .leftJoin(
      publicBoardBlockTable,
      and(
        eq(publicBoardBlockTable.projectId, projectTable.id),
        eq(publicBoardBlockTable.userId, viewer),
      ),
    )
    .where(eq(projectPublicationTable.linkToken, token))
    .limit(1);

  // A trashed project's board is gone (C7).
  if (
    !row ||
    row.publication.publishedAt === null ||
    row.archivedAt ||
    row.deletedAt
  ) {
    notFound();
  }

  return {
    publicationId: row.publication.id,
    token,
    projectId: row.publication.projectId,
    workspaceId: row.workspaceId,
    project: {
      name: row.name,
      slug: row.slug,
      icon: row.icon,
      description: row.description,
      descriptionDeferred: row.descriptionDeferred,
    },
    settings: settingsOf(row.publication),
    intakeEnabled: row.intakeEnabled,
    updatedAt: row.publication.updatedAt,
    viewerIsMember: Boolean(row.memberId),
    viewerBlocked: Boolean(row.blockedId),
    instance,
  };
}

/** Sets `board` from the raw `token` path parameter (runs before validators). */
export function publicBoard(param = "token"): MiddlewareHandler {
  return async (c, next) => {
    const viewer = c.get("viewer") as PublicViewer | undefined;
    c.set(
      "board",
      await resolveBoard(c.req.param(param) ?? "", viewer?.userId ?? null),
    );
    return next();
  };
}

/** Tasks shown on this board: not trashed or archived, not in triage, backlog only when shown. */
export function visibleOnBoard(board: ResolvedBoard) {
  return and(
    eq(taskTable.projectId, board.projectId),
    isNull(taskTable.deletedAt),
    isNull(taskTable.archivedAt),
    sql`not ${inTriageColumnSql}`,
    board.settings.showBacklog
      ? undefined
      : ne(taskTable.status, PLANNED_STATUS),
  );
}

export function parseTaskNumber(raw: string): number {
  if (!/^\d{1,10}$/.test(raw)) notFound(TASK_NOT_ON_BOARD);
  const number = Number(raw);
  if (number < 1 || number > MAX_TASK_NUMBER) notFound(TASK_NOT_ON_BOARD);
  return number;
}

/** The visible task with this number, with its column. */
export async function resolveBoardTask(
  board: ResolvedBoard,
  rawNumber: string,
) {
  const number = parseTaskNumber(rawNumber);
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      status: taskTable.status,
      priority: taskTable.priority,
      dueDate: taskTable.dueDate,
      startDate: taskTable.startDate,
      createdAt: taskTable.createdAt,
      updatedAt: taskTable.updatedAt,
      columnName: columnTable.name,
      columnIcon: columnTable.icon,
      columnGroup: columnTable.group,
      columnIsFinal: columnTable.isFinal,
    })
    .from(taskTable)
    .leftJoin(
      columnTable,
      and(
        eq(columnTable.projectId, taskTable.projectId),
        eq(columnTable.slug, taskTable.status),
      ),
    )
    .where(and(visibleOnBoard(board), eq(taskTable.number, number)))
    .limit(1);
  if (!task) notFound(TASK_NOT_ON_BOARD);
  return task;
}

/** A public comment whose task is visible on this board. */
export async function resolveBoardComment(
  board: ResolvedBoard,
  commentId: string,
) {
  const [comment] = await db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      userId: activityTable.userId,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(activityTable.id, commentId),
        eq(activityTable.type, "comment"),
        eq(activityTable.visibility, "public"),
        visibleOnBoard(board),
      ),
    )
    .limit(1);
  if (!comment) notFound(COMMENT_NOT_FOUND);
  return comment;
}
