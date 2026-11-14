import { randomInt } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import { featureDisabledMessage } from "../project/features";
import {
  BOARD_LIMITS,
  type BoardElement,
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  decodeBoardState,
  elementsMap,
  readSettings,
  writeElements,
} from "./board";
import {
  BOARD_DOC_ORIGIN,
  liveElements,
  persistBoardDocument,
  WhiteboardTooLargeError,
} from "./persistence";
import { editableStateError, WHITEBOARD_MESSAGES } from "./rules";
import type { WhiteboardRecord } from "./shared";

// Server-side content reads and changes, and the seam to live rooms. REST
// never talks to sockets: it goes through the hooks the collaboration layer
// installs. Without a room on this instance, writes go to the stored state
// under the same row lock a room's persist takes.

export type BoardContent = {
  elements: BoardElement[];
  settings: BoardSettings;
  contentVersion: number;
};

export type BoardServerChange = {
  whiteboardId: string;
  actorId: string;
  /** Runs inside the persist, on the merged doc. */
  mutate(doc: Y.Doc): void;
};

export type BoardRoomHooks = {
  /** The live content of the board's room here; null without one. */
  liveContent(whiteboardId: string): Promise<BoardContent | null>;
  /**
   * Applies a change through the board's room here and saves it at once;
   * null when no room is loaded here.
   */
  applyServerChange(
    change: BoardServerChange,
  ): Promise<{ contentVersion: number } | null>;
  /** Rooms of these boards (here and elsewhere) re-read who may write. */
  refreshRooms(whiteboardIds: readonly string[]): Promise<void>;
  /** Rooms of deleted boards close (here and elsewhere) without saving. */
  closeRooms(whiteboardIds: readonly string[]): void;
  /** Hands a stored-state write to rooms on other instances. */
  publishStoredUpdate(
    whiteboardId: string,
    update: Uint8Array,
    actorId: string,
  ): void;
};

const NO_ROOMS: BoardRoomHooks = {
  liveContent: async () => null,
  applyServerChange: async () => null,
  refreshRooms: async () => {},
  closeRooms: () => {},
  publishStoredUpdate: () => {},
};

let hooks: BoardRoomHooks = NO_ROOMS;

export function setBoardRoomHooks(next: BoardRoomHooks | null) {
  hooks = next ?? NO_ROOMS;
}

export function boardRoomHooks(): BoardRoomHooks {
  return hooks;
}

/** The stored content of a row (empty for a board never saved). */
export function storedBoardContent(
  row: Pick<WhiteboardRecord, "contentYjs" | "contentVersion">,
): BoardContent {
  if (!row.contentYjs) {
    return {
      elements: [],
      settings: { ...DEFAULT_BOARD_SETTINGS },
      contentVersion: row.contentVersion,
    };
  }
  const decoded = decodeBoardState(new Uint8Array(row.contentYjs));
  return {
    elements: decoded.elements.filter((element) => !element.deleted),
    settings: decoded.settings,
    contentVersion: row.contentVersion,
  };
}

/** The live room's content when one is open here, else the stored content. */
export async function currentBoardContent(
  row: Pick<WhiteboardRecord, "id" | "contentYjs" | "contentVersion">,
): Promise<BoardContent> {
  return (await hooks.liveContent(row.id)) ?? storedBoardContent(row);
}

/** Content of a doc, for rooms and duplicates. */
export function docContent(doc: Y.Doc, contentVersion: number): BoardContent {
  return {
    elements: liveElements(doc),
    settings: readSettings(doc),
    contentVersion,
  };
}

/**
 * Writes `elements` so they win over what the board holds: each gets a
 * version above the stored one, a fresh nonce and the actor as editor.
 * Throws 409 past the element limit, before anything changes.
 */
export function writeServerElements(
  doc: Y.Doc,
  elements: readonly BoardElement[],
  actorId: string,
  now = Date.now(),
): BoardElement[] {
  const map = elementsMap(doc);
  const added = elements.filter((element) => !map.has(element.id)).length;
  if (map.size + added > BOARD_LIMITS.maxElements) {
    throw new HTTPException(409, {
      message: WHITEBOARD_MESSAGES.tooManyElements,
    });
  }
  const written = elements.map((element) => {
    const stored = map.get(element.id);
    const version = Math.max(element.version, (stored?.version ?? 0) + 1);
    return {
      ...element,
      version,
      nonce: randomInt(2 ** 31 - 1),
      updatedAt: now,
      updatedBy: actorId,
    } as BoardElement;
  });
  writeElements(doc, written, BOARD_DOC_ORIGIN.server);
  return written;
}

/**
 * Applies a server change to a live board: through its room on this
 * instance, or to the stored state (handing the update to rooms elsewhere).
 * Locked and archived boards answer 409.
 */
export async function applyBoardChange(
  change: BoardServerChange,
): Promise<{ contentVersion: number }> {
  const viaRoom = await hooks.applyServerChange(change);
  if (viaRoom) return viaRoom;

  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === BOARD_DOC_ORIGIN.server) updates.push(update);
  });
  try {
    const outcome = await persistBoardDocument({
      whiteboardId: change.whiteboardId,
      doc,
      knownContentVersion: null,
      actorId: change.actorId,
      guard: (row) => {
        const error = editableStateError(row);
        if (error) throw new HTTPException(409, { message: error });
      },
      mutate: change.mutate,
    });
    if (outcome.status === "feature-off") {
      throw new HTTPException(403, {
        message: featureDisabledMessage("whiteboards"),
      });
    }
    if (outcome.status === "gone") {
      throw new HTTPException(404, { message: WHITEBOARD_MESSAGES.notFound });
    }
    if (updates.length > 0) {
      hooks.publishStoredUpdate(
        change.whiteboardId,
        Y.mergeUpdates(updates),
        change.actorId,
      );
    }
    return { contentVersion: outcome.contentVersion };
  } catch (error) {
    if (error instanceof WhiteboardTooLargeError) {
      throw new HTTPException(413, { message: WHITEBOARD_MESSAGES.tooLarge });
    }
    throw error;
  } finally {
    doc.destroy();
  }
}
