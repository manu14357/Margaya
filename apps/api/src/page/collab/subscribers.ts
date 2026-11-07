import { eq } from "drizzle-orm";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { subscribeToEvent } from "../../events";
import {
  closePageRooms,
  pageRoomIdsOfProject,
  refreshPageRooms,
} from "./rooms";

// Page events that change who may see or write a page reach its rooms here
// (spec §5.10, "who publishes meta"). The project-socket hints live in
// ws/index.ts. Title edits are not followed: the title is not in the doc.

type PageEvent = {
  pageId?: string;
  affectedPageIds?: string[];
  pageIds?: string[];
};

for (const eventName of [
  "page.locked",
  "page.unlocked",
  "page.access_changed",
  "page.archived",
  "page.unarchived",
  "page.moved",
]) {
  subscribeToEvent<PageEvent>(
    eventName,
    async ({ pageId, affectedPageIds, pageIds }) => {
      const ids = [
        ...(pageId ? [pageId] : []),
        ...(affectedPageIds ?? []),
        ...(pageIds ?? []),
      ];
      if (ids.length > 0) await refreshPageRooms(ids);
    },
  );
}

// The delete route closes rooms before it deletes; this catches a socket
// that reconnected in between.
subscribeToEvent<PageEvent>("page.deleted", async ({ pageId }) => {
  if (pageId) closePageRooms([pageId]);
});

subscribeToEvent<{ projectId?: string; disabled?: string[] }>(
  "project.features_updated",
  async ({ projectId, disabled }) => {
    if (!projectId || !disabled?.includes("pages")) return;
    // Rooms elsewhere get a `meta` per page of the project (a rare admin
    // action, at most the project's page limit of small messages).
    const rows = await db
      .select({ id: pageTable.id })
      .from(pageTable)
      .where(eq(pageTable.projectId, projectId));
    await refreshPageRooms([
      ...rows.map((row) => row.id),
      ...pageRoomIdsOfProject(projectId),
    ]);
  },
);

// Someone left the workspace or was removed: its rooms re-check their
// connections now, rather than at the next periodic revalidation.
subscribeToEvent<{ workspaceId?: string; accessEnded?: boolean }>(
  "workspace.members_changed",
  async ({ workspaceId, accessEnded }) => {
    if (!workspaceId || !accessEnded) return;
    const rows = await db
      .select({ id: pageTable.id })
      .from(pageTable)
      .where(eq(pageTable.workspaceId, workspaceId));
    await refreshPageRooms(rows.map((row) => row.id));
  },
);

// Restricted projects: someone lost access (removed, or the project was
// restricted). Every room of the project, here and elsewhere, re-checks its
// connections and closes those that can no longer see the project.
subscribeToEvent<{ projectId?: string; action?: string; visibility?: string }>(
  "project.access_changed",
  async ({ projectId, action, visibility }) => {
    if (!projectId) return;
    const lostAccess =
      action === "member_removed" ||
      action === "member_role_changed" ||
      (action === "visibility" && visibility === "restricted");
    if (!lostAccess) return;
    const rows = await db
      .select({ id: pageTable.id })
      .from(pageTable)
      .where(eq(pageTable.projectId, projectId));
    await refreshPageRooms([
      ...rows.map((row) => row.id),
      ...pageRoomIdsOfProject(projectId),
    ]);
  },
);
