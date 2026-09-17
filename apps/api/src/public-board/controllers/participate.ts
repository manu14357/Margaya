import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { intakeItemTable, taskTable } from "../../database/schema";
import { deleteIntakeItem } from "../../intake/controllers/delete-intake-item";
import { effectiveStatusSql } from "../../intake/queries";
import { submitIntakeItem } from "../../intake/service";
import { isIntakeStatus, isOpenIntakeStatus } from "../../intake/status";
import {
  afterKeyset,
  decodeKeyset,
  encodeKeyset,
  timeKey,
} from "../../publication/keyset";
import { removeVote, setVote, type VoteValue } from "../../publication/votes";
import {
  setCommentReaction,
  setTaskReaction,
} from "../../reaction/controllers/reactions";
import { resolveBoardComment, resolveBoardTask } from "../board";
import { publicReactionGroups } from "../counts";
import { sanitizeRequestDescription, sanitizeRequestTitle } from "../sanitize";
import type { PublicViewer, ResolvedBoard } from "../types";
import { visibleTaskNumbers } from "./read";

// Public reactions, votes and requests (B12 §3.4 Q9-Q17, §3.9).

export const REQUEST_NOT_FOUND = "Request not found";
export const NOT_WITHDRAWABLE = "This request can't be withdrawn anymore";
const REQUESTS_PER_PAGE = 20;

function viewerId(viewer: PublicViewer) {
  return viewer.userId as string;
}

/** Q9, Q10. */
export async function setPublicTaskReaction(
  board: ResolvedBoard,
  viewer: PublicViewer,
  rawNumber: string,
  emoji: string,
  add: boolean,
) {
  const task = await resolveBoardTask(board, rawNumber);
  return publicReactionGroups(
    await setTaskReaction(task.id, emoji, viewerId(viewer), add),
  );
}

/** Q11, Q12. */
export async function setPublicCommentReaction(
  board: ResolvedBoard,
  viewer: PublicViewer,
  commentId: string,
  emoji: string,
  add: boolean,
) {
  const comment = await resolveBoardComment(board, commentId);
  return publicReactionGroups(
    await setCommentReaction(comment.id, emoji, viewerId(viewer), add),
  );
}

/** Q13 (a value) and Q14 (null). */
export async function setPublicVote(
  board: ResolvedBoard,
  viewer: PublicViewer,
  rawNumber: string,
  value: VoteValue | null,
) {
  const task = await resolveBoardTask(board, rawNumber);
  const target = {
    taskId: task.id,
    projectId: board.projectId,
    userId: viewerId(viewer),
  };
  return value === null ? removeVote(target) : setVote(target, value);
}

type RequestRow = {
  id: string;
  title: string;
  status: string;
  resolutionNote: string | null;
  createdAt: Date;
  createdAtKey: string;
  taskId: string;
  duplicateOfTaskId: string | null;
};

function publicStatus(status: string) {
  if (!isIntakeStatus(status) || isOpenIntakeStatus(status)) {
    return "in_review" as const;
  }
  return status as "accepted" | "declined" | "duplicate";
}

function selectRequests() {
  return db
    .select({
      id: intakeItemTable.id,
      title: taskTable.title,
      status: effectiveStatusSql,
      resolutionNote: intakeItemTable.resolutionNote,
      createdAt: intakeItemTable.createdAt,
      createdAtKey: timeKey(intakeItemTable.createdAt),
      taskId: intakeItemTable.taskId,
      duplicateOfTaskId: intakeItemTable.duplicateOfTaskId,
    })
    .from(intakeItemTable)
    .innerJoin(taskTable, eq(taskTable.id, intakeItemTable.taskId));
}

async function publicRequests(board: ResolvedBoard, rows: RequestRow[]) {
  const targets = rows.flatMap((row) => {
    const status = publicStatus(row.status);
    if (status === "accepted") return [row.taskId];
    if (status === "duplicate" && row.duplicateOfTaskId) {
      return [row.duplicateOfTaskId];
    }
    return [];
  });
  const visible = await visibleTaskNumbers(board, targets);
  return rows.map((row) => {
    const status = publicStatus(row.status);
    const target =
      status === "accepted"
        ? row.taskId
        : status === "duplicate"
          ? row.duplicateOfTaskId
          : null;
    return {
      id: row.id,
      title: row.title,
      status,
      note:
        status === "declined" || status === "duplicate"
          ? row.resolutionNote
          : null,
      createdAt: row.createdAt,
      boardTaskNumber: target ? (visible.get(target) ?? null) : null,
      canWithdraw: status === "in_review",
    };
  });
}

/** Q15: files a request through B7's intake service. */
export async function submitPublicBoardRequest(
  board: ResolvedBoard,
  viewer: PublicViewer,
  body: { title: string; description?: string },
) {
  const title = sanitizeRequestTitle(body.title);
  const description = sanitizeRequestDescription(body.description);
  const item = await submitIntakeItem({
    projectId: board.projectId,
    submittedBy: viewerId(viewer),
    title,
    description,
    priority: "no-priority",
    source: "public_board",
  });
  const [row] = await selectRequests()
    .where(eq(intakeItemTable.id, item.id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: REQUEST_NOT_FOUND });
  const [request] = await publicRequests(board, [row]);
  return request as NonNullable<typeof request>;
}

/** Q16: the caller's requests on this project (any source), newest first. */
export async function listMyPublicBoardRequests(
  board: ResolvedBoard,
  viewer: PublicViewer,
  cursor: string | undefined,
) {
  const after = cursor ? decodeKeyset(cursor) : null;
  const rows = await selectRequests()
    .where(
      and(
        eq(intakeItemTable.projectId, board.projectId),
        eq(intakeItemTable.submittedBy, viewerId(viewer)),
        after
          ? afterKeyset(
              intakeItemTable.createdAt,
              intakeItemTable.id,
              after,
              "desc",
            )
          : undefined,
      ),
    )
    .orderBy(desc(intakeItemTable.createdAt), desc(intakeItemTable.id))
    .limit(REQUESTS_PER_PAGE + 1);
  const page = rows.slice(0, REQUESTS_PER_PAGE);
  const last = page.at(-1);
  return {
    items: await publicRequests(board, page),
    nextCursor:
      rows.length > REQUESTS_PER_PAGE && last
        ? encodeKeyset(last.createdAtKey, last.id)
        : null,
  };
}

/** Q17: B7's withdraw path, as the submitter of an open request. */
export async function withdrawPublicBoardRequest(
  board: ResolvedBoard,
  viewer: PublicViewer,
  requestId: string,
) {
  const [item] = await db
    .select({ id: intakeItemTable.id, status: effectiveStatusSql })
    .from(intakeItemTable)
    .where(
      and(
        eq(intakeItemTable.id, requestId),
        eq(intakeItemTable.projectId, board.projectId),
        eq(intakeItemTable.submittedBy, viewerId(viewer)),
      ),
    )
    .limit(1);
  if (!item) throw new HTTPException(404, { message: REQUEST_NOT_FOUND });
  if (!isIntakeStatus(item.status) || !isOpenIntakeStatus(item.status)) {
    throw new HTTPException(409, { message: NOT_WITHDRAWABLE });
  }
  await deleteIntakeItem({
    itemId: item.id,
    workspaceId: board.workspaceId,
    userId: viewerId(viewer),
    canDeleteTasks: false,
    canCreateIntake: true,
  });
  return { id: item.id };
}
