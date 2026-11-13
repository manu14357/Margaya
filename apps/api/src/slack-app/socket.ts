import { handleInbound, type SlackInbound } from "./inbound";
import {
  type LoadedSlackConnection,
  listActiveSocketConnections,
  loadConnectionRow,
  recordConnectionStatus,
} from "./store";
import { callSlack, SlackApiError } from "./web-api";

// Socket Mode: the API opens an outbound WebSocket to Slack, so Slack never
// needs to reach this server. Works behind VPNs, NAT and reverse proxies.
//
// Every API instance keeps its own socket per connection; Slack allows up to
// ten per app and hands each envelope to one of them, so replicas need no
// coordination. A reconcile loop picks up settings saved on any instance.

const RECONCILE_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;

type Envelope = {
  envelope_id?: string;
  type?: string;
  payload?: Record<string, unknown>;
  reason?: string;
};

/** Turns a Socket Mode envelope into the transport-neutral inbound shape. */
export function inboundFromEnvelope(envelope: Envelope): SlackInbound | null {
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object") return null;
  if (envelope.type === "slash_commands") return { kind: "command", payload };
  if (envelope.type === "interactive") return { kind: "interactive", payload };
  if (envelope.type === "events_api") return { kind: "event", payload };
  return null;
}

type SocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
};

export type SocketFactory = (url: string) => SocketLike;

const defaultFactory: SocketFactory = (url) =>
  new WebSocket(url) as unknown as SocketLike;

export class SlackSocketClient {
  private socket: SocketLike | null = null;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  connected = false;

  constructor(
    readonly connection: LoadedSlackConnection,
    private readonly factory: SocketFactory = defaultFactory,
    private readonly handle: typeof handleInbound = handleInbound,
  ) {}

  start(): void {
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    this.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.open();
    }, delay);
    this.timer.unref?.();
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    const appToken = this.connection.appToken;
    if (!appToken) {
      await recordConnectionStatus(this.connection.id, {
        connected: false,
        error: "app_token_missing",
      }).catch(() => {});
      return;
    }
    let url: string;
    try {
      const result = await callSlack<{ url?: string }>(
        appToken,
        "apps.connections.open",
      );
      if (typeof result.url !== "string") throw new Error("no url");
      url = result.url;
    } catch (error) {
      const code =
        error instanceof SlackApiError ? error.code : "connection_failed";
      await recordConnectionStatus(this.connection.id, {
        connected: false,
        error: code,
      }).catch(() => {});
      // A revoked or wrong token won't fix itself; retry slowly anyway so a
      // corrected app (same token) comes back without a restart.
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const socket = this.factory(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const data = (event as { data?: unknown }).data;
      void this.onMessage(socket, typeof data === "string" ? data : "");
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      // "close" follows and reconnects.
    });
  }

  private async onMessage(socket: SocketLike, raw: string): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.type === "hello") {
      this.attempt = 0;
      this.connected = true;
      await recordConnectionStatus(this.connection.id, {
        connected: true,
      }).catch(() => {});
      return;
    }
    if (envelope.type === "disconnect") {
      // Slack rotates sockets; open the next one right away.
      this.attempt = 0;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      return;
    }
    const envelopeId = envelope.envelope_id;
    if (!envelopeId) return;
    const inbound = inboundFromEnvelope(envelope);
    if (!inbound) {
      socket.send(JSON.stringify({ envelope_id: envelopeId }));
      return;
    }
    const result = await this.handle(this.connection, inbound);
    try {
      socket.send(
        JSON.stringify(
          result.body === undefined
            ? { envelope_id: envelopeId }
            : { envelope_id: envelopeId, payload: result.body },
        ),
      );
    } catch {
      // The socket closed while handling; Slack retries the envelope.
    }
  }
}

const clients = new Map<
  string,
  { fingerprint: string; client: SlackSocketClient }
>();
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let reconciling: Promise<void> | null = null;

function fingerprint(connection: LoadedSlackConnection): string {
  return `${connection.updatedAt.getTime()}`;
}

async function reconcile(): Promise<void> {
  const rows = await listActiveSocketConnections();
  const wanted = new Map<string, LoadedSlackConnection>();
  for (const row of rows) {
    const connection = loadConnectionRow(row);
    if (connection) wanted.set(connection.id, connection);
  }
  for (const [id, entry] of clients) {
    const next = wanted.get(id);
    if (!next || fingerprint(next) !== entry.fingerprint) {
      entry.client.stop();
      clients.delete(id);
    }
  }
  for (const [id, connection] of wanted) {
    if (clients.has(id)) continue;
    const client = new SlackSocketClient(connection);
    clients.set(id, { fingerprint: fingerprint(connection), client });
    client.start();
  }
}

/** Starts Socket Mode for every active connection; re-checks every minute. */
export function startSlackSocketManager(): void {
  if (started) return;
  started = true;
  void refreshSlackSockets();
  reconcileTimer = setInterval(() => {
    void refreshSlackSockets();
  }, RECONCILE_MS);
  reconcileTimer.unref?.();
}

/** Applies saved settings now (no-op until the manager has started). */
export function refreshSlackSockets(): Promise<void> {
  if (!started) return Promise.resolve();
  if (reconciling) return reconciling;
  reconciling = reconcile()
    .catch((error) => {
      console.error("slack-app: socket reconcile failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    })
    .finally(() => {
      reconciling = null;
    });
  return reconciling;
}

export function stopSlackSocketManager(): void {
  started = false;
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  for (const entry of clients.values()) entry.client.stop();
  clients.clear();
}

/** Whether this instance holds an open socket for the connection. */
export function isSocketConnected(connectionId: string): boolean {
  return clients.get(connectionId)?.client.connected ?? false;
}
