import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectTable,
  whiteboardTable,
  workspaceTable,
} from "../database/schema";
import { publicBoardInstanceState } from "../public-board/instance-state";
import { isLinkTokenFormat } from "../publication/token";
import { boardAsset, streamBoardAsset } from "../whiteboard/assets";
import { type BoardElement, taskIdsOf } from "../whiteboard/board";
import { currentBoardContent } from "../whiteboard/content";
import { loadTaskCards } from "../whiteboard/task-cards";

// Reading a published whiteboard. Every condition that hides it answers the
// same 404, so a revoked link and one that never existed look alike.

const NOT_FOUND = "Whiteboard not found";

function notFound(): HTTPException {
  return new HTTPException(404, { message: NOT_FOUND });
}

async function resolvePublishedBoard(token: string) {
  if (!isLinkTokenFormat(token)) throw notFound();
  // The instance switch for public sharing covers boards as well.
  if (!(await publicBoardInstanceState()).publicBoards) throw notFound();
  const [row] = await db
    .select({
      board: whiteboardTable,
      allowPublicPages: workspaceTable.allowPublicPages,
      deletionDueAt: workspaceTable.deletionDueAt,
      projectDeletedAt: projectTable.deletedAt,
      projectArchivedAt: projectTable.archivedAt,
      enabled: projectTable.whiteboardsEnabled,
    })
    .from(whiteboardTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, whiteboardTable.workspaceId),
    )
    .innerJoin(projectTable, eq(projectTable.id, whiteboardTable.projectId))
    .where(eq(whiteboardTable.publicToken, token))
    .limit(1);
  if (
    !row?.allowPublicPages ||
    row.deletionDueAt !== null ||
    row.projectDeletedAt !== null ||
    row.projectArchivedAt !== null ||
    !row.enabled ||
    row.board.archivedAt !== null ||
    row.board.deletedAt !== null
  ) {
    throw notFound();
  }
  return row.board;
}

/** Elements as the public sees them: who edited what stays private. */
function publicElement(element: BoardElement): BoardElement {
  return { ...element, updatedBy: null };
}

export async function readPublicWhiteboard(token: string) {
  const board = await resolvePublishedBoard(token);
  const content = await currentBoardContent(board);
  const tasks = await loadTaskCards(
    board.projectId,
    taskIdsOf(content.elements),
    { publicView: true },
  );
  return {
    title: board.title,
    icon: board.icon,
    elements: content.elements.map(publicElement),
    settings: content.settings,
    tasks,
    updatedAt: board.updatedAt.toISOString(),
  };
}

/** An image the published board shows; anything else is 404. */
export async function publicWhiteboardAsset(
  token: string,
  assetId: string,
): Promise<Response> {
  const board = await resolvePublishedBoard(token);
  const content = await currentBoardContent(board);
  const shown = content.elements.some(
    (element) => element.type === "image" && element.assetId === assetId,
  );
  if (!shown) throw notFound();
  try {
    return await streamBoardAsset(
      await boardAsset(board.id, assetId),
      "public, max-age=300",
    );
  } catch {
    throw notFound();
  }
}
