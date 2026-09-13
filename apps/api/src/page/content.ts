import {
  applyJsonToYDoc,
  jsonToMarkdown,
  jsonToPlainText,
  jsonToYjsState,
  type PageDocument,
} from "@margaya/editor-schema";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import { featureDisabledMessage } from "../project/features";
import type { PageRecord } from "./controllers/shared";
import {
  PAGE_DOC_ORIGIN,
  PageTooLargeError,
  persistPageDocument,
  storedDocument,
} from "./persistence";
import { editableStateError, PAGE_MESSAGES } from "./rules";
import { PAGE_LIMITS } from "./types";

// Server-side content changes, and the seam to live collaboration rooms.
//
// REST never talks to sockets directly. It goes through `PageRoomHooks`,
// which the collaboration layer installs with `setPageRoomHooks`. Until then
// (and on an instance with no room for the page) the no-room path below
// writes the stored state itself, under the same row lock a room's persist
// uses, so both paths serialize.

export type ServerChange =
  | { kind: "replace"; pageId: string; actorId: string; target: PageDocument }
  | {
      kind: "restore";
      pageId: string;
      actorId: string;
      target: PageDocument;
      versionId: string;
    };

export type ServerChangeResult = { contentVersion: number; changed: boolean };

export type PageRoomHooks = {
  /**
   * Applies a server change through the page's room on this instance (one
   * transaction with origin `server`, then an immediate persist with
   * `restore` for restores), sends the `replaced` or `restored` control
   * message, and returns the result. Returns null when no room for the page
   * is loaded here; the caller then writes the stored state.
   */
  applyServerChange(change: ServerChange): Promise<ServerChangeResult | null>;
  /**
   * The live document of the page's room on this instance, persisted first;
   * null when no room is loaded here. Duplicate reads it.
   */
  liveDocument(pageId: string): Promise<PageDocument | null>;
  /** Closes the rooms of deleted pages (code 4404) without persisting. */
  closeRooms(pageIds: string[]): Promise<void>;
  /**
   * A stored-state write made without a local room produced `update`: hand
   * it to rooms on other instances (the document channel).
   */
  publishStoredUpdate(
    pageId: string,
    update: Uint8Array,
    actorId: string,
  ): void;
};

const NO_ROOMS: PageRoomHooks = {
  applyServerChange: async () => null,
  liveDocument: async () => null,
  closeRooms: async () => {},
  publishStoredUpdate: () => {},
};

let roomHooks: PageRoomHooks = NO_ROOMS;

/** Installs the collaboration layer's hooks (B5b). */
export function setPageRoomHooks(hooks: PageRoomHooks | null) {
  roomHooks = hooks ?? NO_ROOMS;
}

export function pageRoomHooks(): PageRoomHooks {
  return roomHooks;
}

function tooLarge(): HTTPException {
  return new HTTPException(413, { message: PAGE_MESSAGES.tooLarge });
}

/**
 * The stored columns for new content (create, duplicate): a fresh Yjs state
 * and its projections. 413 over 5 MiB.
 */
export function buildPageContent(json: PageDocument) {
  const state = jsonToYjsState(json);
  if (state.byteLength > PAGE_LIMITS.yjsStateBytes) throw tooLarge();
  return {
    contentYjs: Buffer.from(state),
    contentMarkdown: jsonToMarkdown(json),
    contentText: jsonToPlainText(json),
  };
}

/** The page's current document: the live room's when loaded here, else the stored one. */
export async function currentPageDocument(
  page: Pick<PageRecord, "id" | "contentYjs" | "contentMarkdown">,
): Promise<PageDocument> {
  return (await roomHooks.liveDocument(page.id)) ?? storedDocument(page);
}

/**
 * "Apply server change" (§5.6): turns the page content into `target` with a
 * structural diff and persists it at once, through the live room when one
 * is loaded here, otherwise against the stored state. 413 (nothing written)
 * when the result would exceed 5 MiB; 404 when the page is gone.
 */
export async function applyServerChange(
  change: ServerChange,
): Promise<ServerChangeResult> {
  if (jsonToYjsState(change.target).byteLength > PAGE_LIMITS.yjsStateBytes) {
    throw tooLarge();
  }

  try {
    const viaRoom = await roomHooks.applyServerChange(change);
    if (viaRoom) return viaRoom;

    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === PAGE_DOC_ORIGIN.server) updates.push(update);
    });
    try {
      const outcome = await persistPageDocument({
        pageId: change.pageId,
        doc,
        knownContentVersion: null,
        // The page may have been locked or archived since the route checked.
        guard: (row) => {
          const error = editableStateError(row);
          if (error) throw new HTTPException(409, { message: error });
        },
        mutate: (target) =>
          applyJsonToYDoc(target, change.target, PAGE_DOC_ORIGIN.server),
        actorId: change.actorId,
        contributorIds: [change.actorId],
        restore: change.kind === "restore",
      });
      if (outcome.status === "gone") {
        throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
      }
      if (outcome.status === "feature-off") {
        throw new HTTPException(403, {
          message: featureDisabledMessage("pages"),
        });
      }
      if (updates.length > 0) {
        roomHooks.publishStoredUpdate(
          change.pageId,
          Y.mergeUpdates(updates),
          change.actorId,
        );
      }
      return {
        contentVersion: outcome.contentVersion,
        changed: outcome.changed,
      };
    } finally {
      doc.destroy();
    }
  } catch (error) {
    if (error instanceof PageTooLargeError) throw tooLarge();
    throw error;
  }
}
