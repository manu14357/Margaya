import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { PageAccess } from "../types";

// The page socket's wire format: the standard Yjs sync and awareness
// messages (what the stock WebSocket provider speaks), plus Margaya's
// server-to-client control message (type 100). Sync messages are decoded by
// hand, so a read-only connection's update can be refused before anything
// is applied.

export const MESSAGE_TYPE = {
  sync: 0,
  awareness: 1,
  auth: 2,
  queryAwareness: 3,
  control: 100,
} as const;

export type ClientMessage =
  | { type: "sync-step1"; stateVector: Uint8Array }
  | { type: "sync-step2"; update: Uint8Array }
  | { type: "sync-update"; update: Uint8Array }
  | { type: "awareness"; update: Uint8Array }
  | { type: "query-awareness" }
  | { type: "auth" }
  | { type: "unsupported"; messageType: number };

export type OfflineRejectedReason = "locked" | "archived" | "readOnly";

export type ControlMessage =
  | {
      kind: "state";
      canWrite: boolean;
      isLocked: boolean;
      isArchived: boolean;
      access: PageAccess;
      projectId: string | null;
      contentVersion: number;
    }
  | { kind: "saved"; at: string; contentVersion: number }
  | { kind: "save-error" }
  | { kind: "offline-rejected"; reason: OfflineRejectedReason }
  | { kind: "restored"; versionId: string; actorId: string }
  | { kind: "replaced"; actorId: string }
  | { kind: "too-large"; limitBytes: number };

/** Decodes a client frame. Throws on malformed input. */
export function decodeClientMessage(data: Uint8Array): ClientMessage {
  const decoder = decoding.createDecoder(data);
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case MESSAGE_TYPE.sync: {
      const syncType = decoding.readVarUint(decoder);
      const payload = decoding.readVarUint8Array(decoder);
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        return { type: "sync-step1", stateVector: payload };
      }
      if (syncType === syncProtocol.messageYjsSyncStep2) {
        return { type: "sync-step2", update: payload };
      }
      if (syncType === syncProtocol.messageYjsUpdate) {
        return { type: "sync-update", update: payload };
      }
      throw new Error("Unknown sync message");
    }
    case MESSAGE_TYPE.awareness:
      return { type: "awareness", update: decoding.readVarUint8Array(decoder) };
    case MESSAGE_TYPE.queryAwareness:
      return { type: "query-awareness" };
    case MESSAGE_TYPE.auth:
      return { type: "auth" };
    default:
      return { type: "unsupported", messageType };
  }
}

function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** Sync step 1: the doc's state vector. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
    syncProtocol.writeSyncStep1(encoder, doc);
  });
}

/** Sync step 2: what `stateVector` lacks (everything when omitted). */
export function encodeSyncStep2(
  doc: Y.Doc,
  stateVector?: Uint8Array,
): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
    syncProtocol.writeSyncStep2(encoder, doc, stateVector);
  });
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
    syncProtocol.writeUpdate(encoder, update);
  });
}

export function encodeAwarenessMessage(update: Uint8Array): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_TYPE.awareness);
    encoding.writeVarUint8Array(encoder, update);
  });
}

export function encodeQueryAwareness(): Uint8Array {
  return frame((encoder) =>
    encoding.writeVarUint(encoder, MESSAGE_TYPE.queryAwareness),
  );
}

/** Control message: type 100, then the JSON payload as a varstring. */
export function encodeControl(message: ControlMessage): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_TYPE.control);
    encoding.writeVarString(encoder, JSON.stringify(message));
  });
}

/** The control payload of a server frame, or null for other frames. */
export function decodeControl(data: Uint8Array): ControlMessage | null {
  const decoder = decoding.createDecoder(data);
  if (decoding.readVarUint(decoder) !== MESSAGE_TYPE.control) return null;
  return JSON.parse(decoding.readVarString(decoder)) as ControlMessage;
}

/** Whether every clock of `[clock, clock + length)` is deleted in `ds`. */
function rangeDeleted(
  ds: ReturnType<typeof Y.createDeleteSetFromStructStore>,
  client: number,
  clock: number,
  length: number,
): boolean {
  // The store's delete set holds sorted, merged ranges per client.
  for (const item of ds.clients.get(client) ?? []) {
    if (item.clock <= clock && clock + length <= item.clock + item.len) {
      return true;
    }
    if (item.clock > clock) return false;
  }
  return false;
}

/**
 * Whether applying `update` would add anything to `doc`: an item it lacks,
 * or a deletion of an item it still holds. Diff updates (a client's sync
 * step 2) carry the client's whole delete set, so deletions the doc already
 * has never count.
 */
export function updateHasNewContent(doc: Y.Doc, update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  for (const struct of structs) {
    if (struct instanceof Y.Skip) continue;
    const known = Y.getState(doc.store, struct.id.client);
    if (struct.id.clock + struct.length > known) return true;
  }
  let docDeletes: ReturnType<typeof Y.createDeleteSetFromStructStore> | null =
    null;
  for (const [client, items] of ds.clients) {
    const known = Y.getState(doc.store, client);
    for (const item of items) {
      if (item.clock + item.len > known) return true;
      docDeletes ??= Y.createDeleteSetFromStructStore(doc.store);
      if (!rangeDeleted(docDeletes, client, item.clock, item.len)) return true;
    }
  }
  return false;
}
