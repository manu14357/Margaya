import type { NodeWebSocket } from "@hono/node-ws";
import { HTTPException } from "hono/http-exception";
import { authenticateApiRequest } from "../../utils/authenticate-api-request";
import { assertWebSocketOrigin } from "../../ws/security";
import { authorizePageSocket } from "./access";
import { PageConnection } from "./connection";
import { COLLAB_CLOSE } from "./limits";
import type { PageRoom } from "./room";
import { pageRoomFor } from "./rooms";
import "./subscribers";

// GET /api/ws/page/{pageId}?windowId=…: the page collaboration socket. The
// handshake mirrors the project socket (origin, authentication, workspace
// access) plus the page rules; then the room speaks the Yjs sync and
// awareness protocol over binary frames.

type RawSocket = {
  ping?: () => void;
  on?: (event: "pong", listener: () => void) => void;
};

function frameBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

export function pageCollabWebSocket(
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"],
) {
  return upgradeWebSocket(async (c) => {
    assertWebSocketOrigin(c.req.raw.headers);
    try {
      await authenticateApiRequest(c);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("API authentication failed:", error);
      throw new HTTPException(500, { message: "Internal Server Error" });
    }

    const pageId = c.req.param("pageId") ?? "";
    const grant = await authorizePageSocket(c, pageId);
    let connection: PageConnection | null = null;
    let room: PageRoom | null = null;

    return {
      onOpen(_event, ws) {
        const raw = ws.raw as RawSocket | undefined;
        const open = new PageConnection(
          {
            send: (data) => ws.send(data as Uint8Array<ArrayBuffer>),
            close: (code, reason) => ws.close(code, reason),
            ping: raw?.ping ? () => raw.ping?.() : undefined,
          },
          grant.identity,
          grant.caller,
        );
        raw?.on?.("pong", () => {
          open.alive = true;
        });
        connection = open;
        room = pageRoomFor(pageId);
        room.addConnection(open);
      },
      onMessage(event) {
        if (!connection || !room) return;
        const bytes = frameBytes(event.data);
        if (!bytes) {
          connection.close(COLLAB_CLOSE.binaryOnly, "Binary messages only");
          return;
        }
        room.receive(connection, bytes);
      },
      onClose() {
        if (!connection) return;
        connection.closed = true;
        room?.removeConnection(connection);
      },
    };
  });
}
