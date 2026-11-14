import { COLLAB_CLOSE } from "../../page/collab/limits";
import type { DocBroadcast } from "../../ws/broadcast-adapter";
import type { BoardDocChannel, WhiteboardRoom } from "./room";

// Receiving rules of the document channel for board rooms: the same kinds
// as page rooms, under the board's own channel key. Single-instance
// deployments never receive anything here.

function fromBase64(data: string | undefined): Uint8Array | null {
  if (!data) return null;
  return new Uint8Array(Buffer.from(data, "base64"));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function handleBoardBroadcast(
  room: WhiteboardRoom,
  message: DocBroadcast,
  channel: BoardDocChannel,
) {
  if (room.isClosed) return;
  try {
    switch (message.kind) {
      case "update":
      case "sync-reply": {
        const update = fromBase64(message.data);
        if (update) room.applyRemoteUpdate(update, message.userId ?? null);
        return;
      }
      case "awareness": {
        const update = fromBase64(message.data);
        if (update) room.applyRemoteAwareness(update);
        return;
      }
      case "sync-request": {
        const stateVector = fromBase64(message.data);
        if (!stateVector) return;
        channel.publish({
          pageId: room.channelKey,
          kind: "sync-reply",
          target: message.origin,
          data: toBase64(room.diffAgainst(stateVector)),
        });
        return;
      }
      case "awareness-query": {
        const update = room.localAwarenessUpdate();
        if (!update) return;
        channel.publish({
          pageId: room.channelKey,
          kind: "awareness",
          target: message.origin,
          data: toBase64(update),
        });
        return;
      }
      case "meta":
        if (message.deleted) {
          room.close(COLLAB_CLOSE.gone, "Whiteboard deleted");
          return;
        }
        void room.refresh().catch((error) => {
          console.error(
            `Board room ${room.whiteboardId} refresh failed:`,
            error,
          );
        });
        return;
    }
  } catch (error) {
    console.error(
      `Dropped a ${message.kind} message for board ${room.whiteboardId}:`,
      error,
    );
  }
}
