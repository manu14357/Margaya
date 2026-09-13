import { MAX_WEBSOCKET_FRAME_BYTES } from "../../ws/security";
import { PAGE_LIMITS } from "../types";

// Limits of the page collaboration socket (spec §5.9). Exported for tests.

export const COLLAB_LIMITS = {
  /**
   * The largest inbound WebSocket message for every socket (the server's
   * `maxPayload`). The project and user sockets keep their own 64-byte rule.
   */
  maxFrameBytes: MAX_WEBSOCKET_FRAME_BYTES,
  /** Encoded document state. */
  docStateBytes: PAGE_LIMITS.yjsStateBytes,
  /** One awareness entry's JSON state. */
  awarenessEntryBytes: 8 * 1024,
  /** Awareness client ids one connection may control. */
  clientIdsPerConnection: 4,
  /** Inbound messages per connection per window. */
  messagesPerWindow: 1000,
  rateWindowMs: 10_000,
  /** Connections per room on one instance. */
  connectionsPerRoom: 100,
  persistDebounceMs: 2000,
  persistMaxWaitMs: 10_000,
  /** Delays after the 1st, 2nd and later consecutive persist failures. */
  persistRetryMs: [5000, 15_000, 60_000],
  /** A room with no local connections unloads after this grace period. */
  idleUnloadMs: 30_000,
  /** Sessions, membership and permissions are re-read this often. */
  revalidateMs: 5 * 60 * 1000,
  /** Server pings; a connection that misses one pong is dropped. */
  heartbeatMs: 30_000,
  /** At most one `offline-rejected` per connection per window. */
  offlineRejectedMs: 60_000,
  /** Shutdown waits this long for dirty rooms to persist. */
  shutdownFlushMs: 5000,
  /** Base64 data of one document-channel message. */
  channelDataChars: 8 * 1024 * 1024,
} as const;

/** Collaborator color keys the web renders (palette keys only, never CSS). */
export const COLLAB_COLORS = [
  "blue",
  "emerald",
  "amber",
  "purple",
  "rose",
  "orange",
  "teal",
  "cyan",
] as const;

/**
 * Close codes. 4400–4499 are terminal for the client (it stops
 * reconnecting); 4500–4599 and network codes reconnect with backoff.
 */
export const COLLAB_CLOSE = {
  /** Session ended or API key revoked. */
  unauthorized: 4401,
  /** The caller can no longer see the page. */
  forbidden: 4403,
  /** The page was deleted, or Pages were turned off for its project. */
  gone: 4404,
  /** The document grew past the state limit. */
  tooLarge: 4413,
  /** The room is full. */
  roomFull: 4429,
  /** The server is shutting down; reconnect. */
  restarting: 4503,
  /** Too many messages; reconnect after a backoff. */
  rateLimited: 4529,
  /** A text frame. */
  binaryOnly: 1003,
  /** A protocol violation. */
  unsupported: 1008,
  /** The room failed to load; reconnect. */
  internalError: 1011,
} as const;
