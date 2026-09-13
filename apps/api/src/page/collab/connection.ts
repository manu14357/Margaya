import type { PageCaller } from "../rules";
import { COLLAB_CLOSE, COLLAB_LIMITS } from "./limits";
import { type ControlMessage, encodeControl } from "./protocol";

// One page socket. The room owns the protocol; this holds the identity, the
// cached permissions, the rate limit and the client ids the socket controls.

export type CollabSocket = {
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
  /** Sends a WebSocket ping (absent in unit tests). */
  ping?(): void;
};

export type ConnectionIdentity = {
  userId: string;
  workspaceId: string;
  /** The session the socket authenticated with (null for API keys). */
  sessionId: string | null;
  apiKeyId: string | null;
  apiKeyPermissions: Record<string, string[]> | null;
  /** "<userId>:<windowId>", as on the project socket. */
  initiatorId: string;
};

let nextConnectionId = 1;

export class PageConnection {
  readonly id = nextConnectionId++;
  /** Awareness client ids whose states this socket owns. */
  readonly controlled = new Set<number>();
  /** Frames received before the room was ready, in order. */
  readonly queue: Uint8Array[] = [];
  canWrite = false;
  /** The room sent its greeting (sync step 1, awareness, state). */
  greeted = false;
  closed = false;
  /** Answered the last ping. */
  alive = true;
  private windowStart = 0;
  private messagesInWindow = 0;
  private lastOfflineRejected = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly socket: CollabSocket,
    readonly identity: ConnectionIdentity,
    public caller: PageCaller,
  ) {}

  get userId() {
    return this.identity.userId;
  }

  send(data: Uint8Array) {
    if (this.closed) return;
    try {
      this.socket.send(data);
    } catch {
      this.close(COLLAB_CLOSE.internalError, "Send failed");
    }
  }

  sendControl(message: ControlMessage) {
    this.send(encodeControl(message));
  }

  close(code: number, reason: string) {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch {
      // Already closed underneath.
    }
  }

  /** Counts a frame; false once the connection exceeds its rate. */
  admit(now = Date.now()): boolean {
    if (now - this.windowStart >= COLLAB_LIMITS.rateWindowMs) {
      this.windowStart = now;
      this.messagesInWindow = 0;
    }
    this.messagesInWindow++;
    return this.messagesInWindow <= COLLAB_LIMITS.messagesPerWindow;
  }

  /** True at most once per window: may this socket get `offline-rejected`? */
  mayNotifyOfflineRejected(now = Date.now()): boolean {
    if (now - this.lastOfflineRejected < COLLAB_LIMITS.offlineRejectedMs) {
      return false;
    }
    this.lastOfflineRejected = now;
    return true;
  }

  /** Pings the client; false when the previous ping went unanswered. */
  heartbeat(): boolean {
    if (!this.socket.ping) return true;
    if (!this.alive) return false;
    this.alive = false;
    try {
      this.socket.ping();
    } catch {
      return false;
    }
    return true;
  }
}
