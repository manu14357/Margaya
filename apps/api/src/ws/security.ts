import { HTTPException } from "hono/http-exception";
import type { WSContext } from "hono/ws";
import { isTrustedOrigin } from "../utils/trusted-origins";

// Two inbound limits apply to every WebSocket:
//
// - MAX_WEBSOCKET_FRAME_BYTES (1 MiB) is the server's `maxPayload`: the `ws`
//   library closes a connection with 1009 before delivering any message
//   (fragmented ones included) over it. Page collaboration needs it, since
//   Yjs updates (a paste, an offline catch-up) are binary and can be large.
// - The project and user sockets accept only the 64-byte text keepalive.
//   handleWebSocketMessage enforces that per message (1009 over 64 bytes,
//   1003 for binary, 1008 for anything but the keepalive).
//
// Trade-off: an authenticated project or user socket can make the server
// buffer up to 1 MiB before that check closes it. The page socket applies
// its own limits (page/collab/limits.ts): a rate limit per connection,
// awareness entry caps, and the document state limit.
export const MAX_WEBSOCKET_FRAME_BYTES = 1024 * 1024;
export const MAX_WEBSOCKET_MESSAGE_BYTES = 64;

export function assertWebSocketOrigin(headers: Headers) {
  const origin = headers.get("origin");
  if (origin === null) {
    // Native clients may omit Origin, but must supply explicit credentials.
    // authenticateApiRequest still validates them and rejects invalid tokens;
    // a cookie alone must never bypass the browser-origin boundary.
    if (
      /^Bearer\s+\S+$/i.test(headers.get("authorization") ?? "") ||
      headers.get("x-api-key")?.trim()
    ) {
      return;
    }
  } else if (isTrustedOrigin(origin)) {
    return;
  }
  throw new HTTPException(403, { message: "WebSocket origin is not allowed" });
}

function messageBytes(data: unknown): number {
  if (typeof data === "string") {
    // Cheap bound first: UTF-8 never takes fewer bytes than UTF-16 units.
    return data.length > MAX_WEBSOCKET_MESSAGE_BYTES
      ? data.length
      : Buffer.byteLength(data, "utf8");
  }
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof Blob) return data.size;
  return Number.POSITIVE_INFINITY;
}

export function handleWebSocketMessage(
  evt: MessageEvent<unknown>,
  ws: WSContext,
) {
  // Size first, so an oversized frame of any kind closes with 1009 as it
  // did when the server-wide limit was 64 bytes.
  if (messageBytes(evt.data) > MAX_WEBSOCKET_MESSAGE_BYTES) {
    ws.close(1009, "Message too large");
    return;
  }
  if (typeof evt.data !== "string") {
    ws.close(1003, "Only text keepalives are supported");
    return;
  }
  // Both web clients send this exact keepalive. No arbitrary JSON needs to be
  // parsed, copied or dispatched. Receiving it is enough to keep proxies alive.
  if (evt.data !== '{"type":"ping"}') {
    ws.close(1008, "Unsupported message");
  }
}
