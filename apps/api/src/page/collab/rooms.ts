import {
  publishDocBroadcast,
  subscribeToDocBroadcasts,
  unsubscribeFromDocBroadcasts,
} from "../../ws";
import { setPageRoomHooks } from "../content";
import { persistPageDocument } from "../persistence";
import { revalidatePageConnection } from "./access";
import { handleDocBroadcast } from "./fanout";
import { COLLAB_CLOSE, COLLAB_LIMITS } from "./limits";
import { loadPageState, readPageMeta } from "./meta";
import { type DocChannel, PageRoom, type RoomDeps } from "./room";

// The process-local room registry: one room per page with live sockets on
// this instance. It installs the room side of the REST content hooks.

const rooms = new Map<string, PageRoom>();

const channel: DocChannel = {
  publish: publishDocBroadcast,
  subscribe: subscribeToDocBroadcasts,
  unsubscribe: unsubscribeFromDocBroadcasts,
};

const deps: RoomDeps = {
  load: loadPageState,
  readMeta: readPageMeta,
  persist: persistPageDocument,
  revalidate: revalidatePageConnection,
  channel,
  onDocBroadcast: (room, message) => handleDocBroadcast(room, message, channel),
  onClosed: (room) => {
    if (rooms.get(room.pageId) === room) rooms.delete(room.pageId);
  },
};

/** The page's room, created (and loading) when none is open here. */
export function pageRoomFor(pageId: string): PageRoom {
  const existing = rooms.get(pageId);
  if (existing && !existing.isClosed) return existing;
  const room = new PageRoom(pageId, deps);
  rooms.set(pageId, room);
  return room;
}

/** The page's room when one is open on this instance. */
export function loadedPageRoom(pageId: string): PageRoom | undefined {
  const room = rooms.get(pageId);
  return room && !room.isClosed ? room : undefined;
}

/** Rooms open on this instance (for tests and diagnostics). */
export function openPageRoomCount(): number {
  return rooms.size;
}

/** Persists every dirty room now, and waits for running persists. */
export async function flushAllPageRooms(): Promise<void> {
  await Promise.allSettled([...rooms.values()].map((room) => room.flush()));
}

/**
 * Shutdown: persists dirty rooms (within a budget), then closes every page
 * socket with 4503 so clients reconnect, possibly to another instance.
 */
export async function shutdownPageRooms(
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

/**
 * The pages changed in a way rooms must follow (lock, access, archive,
 * move, Pages turned off): rooms here re-read them, rooms elsewhere get a
 * `meta` message.
 */
export async function refreshPageRooms(pageIds: readonly string[]) {
  const unique = [...new Set(pageIds)];
  for (const pageId of unique) publishDocBroadcast({ pageId, kind: "meta" });
  await Promise.allSettled(
    unique.map((pageId) => loadedPageRoom(pageId)?.refresh()),
  );
}

/** Deleted pages: their rooms close with 4404 here and elsewhere, unsaved. */
export function closePageRooms(pageIds: readonly string[]) {
  for (const pageId of new Set(pageIds)) {
    loadedPageRoom(pageId)?.close(COLLAB_CLOSE.gone, "Page deleted");
    publishDocBroadcast({ pageId, kind: "meta", deleted: true });
  }
}

/** Open rooms of a project (Pages turned off). */
export function pageRoomIdsOfProject(projectId: string): string[] {
  return [...rooms.values()]
    .filter((room) => !room.isClosed && room.meta?.projectId === projectId)
    .map((room) => room.pageId);
}

setPageRoomHooks({
  applyServerChange: async (change) =>
    (await loadedPageRoom(change.pageId)?.applyServerChange(change)) ?? null,
  liveDocument: async (pageId) =>
    (await loadedPageRoom(pageId)?.liveDocument()) ?? null,
  closeRooms: async (pageIds) => closePageRooms(pageIds),
  publishStoredUpdate: (pageId, update, actorId) =>
    publishDocBroadcast({
      pageId,
      kind: "update",
      userId: actorId,
      data: Buffer.from(update).toString("base64"),
    }),
});
