import { COLLAB_CLOSE, COLLAB_LIMITS } from "../../page/collab/limits";
import {
  publishDocBroadcast,
  subscribeToDocBroadcasts,
  unsubscribeFromDocBroadcasts,
} from "../../ws";
import { setBoardRoomHooks } from "../content";
import { persistBoardDocument } from "../persistence";
import { revalidateBoardConnection } from "./access";
import { handleBoardBroadcast } from "./fanout";
import { loadBoardState, readBoardMeta } from "./meta";
import {
  type BoardDocChannel,
  type BoardRoomDeps,
  boardChannelKey,
  WhiteboardRoom,
} from "./room";

// The process-local registry: one room per board with live sockets on this
// instance. It installs the room side of the REST content hooks.

const rooms = new Map<string, WhiteboardRoom>();

const channel: BoardDocChannel = {
  publish: publishDocBroadcast,
  subscribe: subscribeToDocBroadcasts,
  unsubscribe: unsubscribeFromDocBroadcasts,
};

const deps: BoardRoomDeps = {
  load: loadBoardState,
  readMeta: readBoardMeta,
  persist: persistBoardDocument,
  revalidate: revalidateBoardConnection,
  channel,
  onDocBroadcast: (room, message) =>
    handleBoardBroadcast(room, message, channel),
  onClosed: (room) => {
    if (rooms.get(room.whiteboardId) === room) rooms.delete(room.whiteboardId);
  },
};

/** The board's room, created (and loading) when none is open here. */
export function whiteboardRoomFor(whiteboardId: string): WhiteboardRoom {
  const existing = rooms.get(whiteboardId);
  if (existing && !existing.isClosed) return existing;
  const room = new WhiteboardRoom(whiteboardId, deps);
  rooms.set(whiteboardId, room);
  return room;
}

export function loadedWhiteboardRoom(
  whiteboardId: string,
): WhiteboardRoom | undefined {
  const room = rooms.get(whiteboardId);
  return room && !room.isClosed ? room : undefined;
}

/** Rooms open on this instance (for tests and diagnostics). */
export function openWhiteboardRoomCount(): number {
  return rooms.size;
}

export async function flushAllWhiteboardRooms(): Promise<void> {
  await Promise.allSettled([...rooms.values()].map((room) => room.flush()));
}

/**
 * Shutdown: persists dirty rooms within a budget, then closes every board
 * socket with 4503 so clients reconnect, possibly to another instance.
 */
export async function shutdownWhiteboardRooms(
  budgetMs: number = COLLAB_LIMITS.shutdownFlushMs,
): Promise<void> {
  const open = [...rooms.values()];
  if (open.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(open.map((room) => room.flush())),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  for (const room of open) {
    room.close(COLLAB_CLOSE.restarting, "Server restarting");
  }
}

/** Boards changed in a way rooms must follow: re-read here, `meta` elsewhere. */
export async function refreshWhiteboardRooms(whiteboardIds: readonly string[]) {
  const unique = [...new Set(whiteboardIds)];
  for (const id of unique) {
    publishDocBroadcast({ pageId: boardChannelKey(id), kind: "meta" });
  }
  await Promise.allSettled(
    unique.map((id) => loadedWhiteboardRoom(id)?.refresh()),
  );
}

/** Deleted boards: their rooms close with 4404 here and elsewhere, unsaved. */
export function closeWhiteboardRooms(whiteboardIds: readonly string[]) {
  for (const id of new Set(whiteboardIds)) {
    loadedWhiteboardRoom(id)?.close(COLLAB_CLOSE.gone, "Whiteboard deleted");
    publishDocBroadcast({
      pageId: boardChannelKey(id),
      kind: "meta",
      deleted: true,
    });
  }
}

/** Open rooms of a project (Whiteboards turned off, project trashed). */
export function whiteboardRoomIdsOfProject(projectId: string): string[] {
  return [...rooms.values()]
    .filter((room) => !room.isClosed && room.meta?.projectId === projectId)
    .map((room) => room.whiteboardId);
}

setBoardRoomHooks({
  liveContent: async (whiteboardId) =>
    (await loadedWhiteboardRoom(whiteboardId)?.liveContent()) ?? null,
  applyServerChange: async (change) =>
    (await loadedWhiteboardRoom(change.whiteboardId)?.applyServerChange(
      change,
    )) ?? null,
  refreshRooms: refreshWhiteboardRooms,
  closeRooms: closeWhiteboardRooms,
  publishStoredUpdate: (whiteboardId, update, actorId) =>
    publishDocBroadcast({
      pageId: boardChannelKey(whiteboardId),
      kind: "update",
      userId: actorId,
      data: Buffer.from(update).toString("base64"),
    }),
});
