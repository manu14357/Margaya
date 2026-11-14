import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { whiteboardTable, workspaceTable } from "../database/schema";
import { publishEvent } from "../events";
import { generateLinkToken } from "../publication/token";
import { WHITEBOARD_MESSAGES, type WhiteboardCaller } from "./rules";
import { loadWhiteboard, whiteboardEventPayload } from "./shared";

// Publishing a board to a read-only public link. Boards follow the
// workspace's public pages setting (an admin switch, off by default). Each
// publish issues a new token; unpublishing, archiving or trashing revokes it.

function assertManager(caller: WhiteboardCaller) {
  if (!caller.isManager) {
    throw new HTTPException(403, { message: WHITEBOARD_MESSAGES.managerOnly });
  }
}

async function workspaceAllowsPublicBoards(workspaceId: string) {
  const [row] = await db
    .select({ allow: workspaceTable.allowPublicPages })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return row?.allow === true;
}

export async function publishWhiteboard(
  whiteboardId: string,
  caller: WhiteboardCaller,
) {
  assertManager(caller);
  const board = await loadWhiteboard(db, whiteboardId);
  if (!(await workspaceAllowsPublicBoards(board.workspaceId))) {
    throw new HTTPException(409, {
      message: WHITEBOARD_MESSAGES.publicDisabled,
    });
  }
  if (board.archivedAt !== null) {
    throw new HTTPException(409, {
      message: WHITEBOARD_MESSAGES.publishArchived,
    });
  }
  const [published] = await db
    .update(whiteboardTable)
    .set({
      publicToken: generateLinkToken(),
      publishedAt: new Date(),
      publishedById: caller.userId,
    })
    .where(
      and(
        eq(whiteboardTable.id, board.id),
        isNull(whiteboardTable.archivedAt),
        isNull(whiteboardTable.deletedAt),
      ),
    )
    .returning();
  if (!published) {
    throw new HTTPException(409, {
      message: WHITEBOARD_MESSAGES.publishArchived,
    });
  }
  await publishEvent("whiteboard.updated", {
    ...whiteboardEventPayload(published, caller.userId),
    change: "published",
    title: published.title,
  });
  return {
    publicToken: published.publicToken,
    publishedAt: published.publishedAt,
  };
}

export async function unpublishWhiteboard(
  whiteboardId: string,
  caller: WhiteboardCaller,
) {
  assertManager(caller);
  const board = await loadWhiteboard(db, whiteboardId);
  const [revoked] = await db
    .update(whiteboardTable)
    .set({ publicToken: null, publishedAt: null, publishedById: null })
    .where(
      and(
        eq(whiteboardTable.id, board.id),
        isNotNull(whiteboardTable.publicToken),
      ),
    )
    .returning();
  if (revoked) {
    await publishEvent("whiteboard.updated", {
      ...whiteboardEventPayload(revoked, caller.userId),
      change: "unpublished",
      title: revoked.title,
    });
  }
  return { publicToken: null, publishedAt: null };
}
