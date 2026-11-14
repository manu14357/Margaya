import { eq } from "drizzle-orm";
import db from "../../database";
import { whiteboardTable } from "../../database/schema";
import { subscribeToEvent } from "../../events";
import {
  closeWhiteboardRooms,
  refreshWhiteboardRooms,
  whiteboardRoomIdsOfProject,
} from "./rooms";

// Events that change who may write a board reach its rooms here. Title and
// icon edits are not followed: they are not in the doc. Role edits are
// picked up by the rooms' periodic revalidation, as on page rooms.

type BoardEvent = { whiteboardId?: string; change?: string };

const WRITE_STATE_CHANGES = new Set([
  "locked",
  "unlocked",
  "archived",
  "unarchived",
]);

subscribeToEvent<BoardEvent>(
  "whiteboard.updated",
  async ({ whiteboardId, change }) => {
    if (whiteboardId && change && WRITE_STATE_CHANGES.has(change)) {
      await refreshWhiteboardRooms([whiteboardId]);
    }
  },
);

// The delete route closes rooms before it deletes; this catches a socket
// that reconnected in between.
subscribeToEvent<BoardEvent>("whiteboard.deleted", async ({ whiteboardId }) => {
  if (whiteboardId) closeWhiteboardRooms([whiteboardId]);
});

async function projectBoardIds(projectId: string) {
  const rows = await db
    .select({ id: whiteboardTable.id })
    .from(whiteboardTable)
    .where(eq(whiteboardTable.projectId, projectId));
  return [
    ...rows.map((row) => row.id),
    ...whiteboardRoomIdsOfProject(projectId),
  ];
}

subscribeToEvent<{ projectId?: string; disabled?: string[] }>(
  "project.features_updated",
  async ({ projectId, disabled }) => {
    if (!projectId || !disabled?.includes("whiteboards")) return;
    await refreshWhiteboardRooms(await projectBoardIds(projectId));
  },
);

// A project in the trash takes its boards with it.
subscribeToEvent<{ projectId?: string }>(
  "project.deleted",
  async ({ projectId }) => {
    if (projectId) {
      await refreshWhiteboardRooms(await projectBoardIds(projectId));
    }
  },
);

subscribeToEvent<{ workspaceId?: string; accessEnded?: boolean }>(
  "workspace.members_changed",
  async ({ workspaceId, accessEnded }) => {
    if (!workspaceId || !accessEnded) return;
    const rows = await db
      .select({ id: whiteboardTable.id })
      .from(whiteboardTable)
      .where(eq(whiteboardTable.workspaceId, workspaceId));
    await refreshWhiteboardRooms(rows.map((row) => row.id));
  },
);

// Restricted projects: someone lost access (removed, or the project was
// restricted). Every room of the project re-checks its connections.
subscribeToEvent<{ projectId?: string; action?: string; visibility?: string }>(
  "project.access_changed",
  async ({ projectId, action, visibility }) => {
    if (!projectId) return;
    const lostAccess =
      action === "member_removed" ||
      action === "member_role_changed" ||
      (action === "visibility" && visibility === "restricted");
    if (lostAccess) {
      await refreshWhiteboardRooms(await projectBoardIds(projectId));
    }
  },
);
