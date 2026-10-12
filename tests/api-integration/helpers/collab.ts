import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { serve } from "../../../apps/api/node_modules/@hono/node-server";
import type { NodeWebSocket } from "../../../apps/api/node_modules/@hono/node-ws";
// The API's own copies (one Yjs instance), as for the node-ws client below.
import {
  jsonToMarkdown,
  yDocToJson,
} from "../../../apps/api/node_modules/@margaya/editor-schema";
import { auth } from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import {
  type ControlMessage,
  decodeControl,
  MESSAGE_TYPE,
} from "../../../apps/api/src/page/collab/protocol";

// A minimal page-socket client speaking the same protocol as the web's
// WebSocket provider: sync step 1 on open, step 2 replies, updates for local
// changes, awareness, and Margaya's control messages (type 100).

type Socket = NodeWebSocket["wss"]["clients"] extends Set<infer S> ? S : never;
const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const nodeWsRequire = createRequire(apiRequire.resolve("@hono/node-ws"));
export const WebSocket: new (
  url: string,
  options: { headers: Record<string, string> },
) => Socket = nodeWsRequire("ws").WebSocket;

type User = typeof schema.userTable.$inferSelect;

export const ORIGIN = "http://localhost:5173";

/** Cookie headers that the mocked session lookup maps to `user`. */
export function headersFor(user: Pick<User, "id">): Record<string, string> {
  return { cookie: `test-session=${user.id}`, origin: ORIGIN };
}

/**
 * Sessions keyed by cookie, each backed by a real session row so socket
 * revalidation finds it.
 */
export async function mockSessions(users: User[]) {
  const sessions = new Map<string, { session: unknown; user: User }>();
  const now = new Date();
  for (const user of users) {
    const session = {
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      userId: user.id,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    };
    await db.insert(schema.sessionTable).values(session).onConflictDoNothing();
    sessions.set(`test-session=${user.id}`, { session, user });
  }
  vi.spyOn(auth.api, "getSession").mockImplementation((async ({
    headers,
  }: {
    headers: Headers;
  }) => {
    const cookie = new Headers(headers).get("cookie") ?? "";
    return sessions.get(cookie) ?? null;
  }) as never);
}

export type TestServer = {
  baseUrl: string;
  close(): Promise<void>;
  /** A REST request to /api/page as `user` (cookie session). */
  rest(
    user: Pick<User, "id">,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
};

export async function startServer(): Promise<TestServer> {
  const created = createApp();
  const rest = (user: Pick<User, "id">, path: string, init?: RequestInit) =>
    created.app.request(`/api/page${path}`, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        cookie: `test-session=${user.id}`,
      },
    });
  const server = serve({
    fetch: created.app.fetch,
    hostname: "127.0.0.1",
    port: 0,
  });
  created.injectWebSocket(server);
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    baseUrl: `ws://127.0.0.1:${address.port}`,
    rest,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Polls until `check` returns a truthy value. */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  { timeoutMs = 5000, message = "condition" } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const openClients = new Set<CollabClient>();

/** Terminates every client opened by the tests. */
export function terminateClients() {
  for (const client of openClients) client.socket.terminate();
  openClients.clear();
}

export class CollabClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly controls: ControlMessage[] = [];
  /** Awareness states received from the server, by client id. */
  readonly remoteStates = new Map<number, unknown>();
  closeCode: number | null = null;
  synced = false;

  private constructor(readonly socket: Socket) {
    this.awareness.setLocalState(null);
    socket.on("message", (data: Buffer) => this.receive(new Uint8Array(data)));
    socket.on("close", (code: number) => {
      this.closeCode = code;
    });
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
      syncProtocol.writeUpdate(encoder, update);
      this.send(encoding.toUint8Array(encoder));
    });
  }

  /** Opens a socket; the status is 101 on upgrade, else the HTTP status. */
  static async connect(
    baseUrl: string,
    pageId: string,
    headers: Record<string, string>,
  ): Promise<{ client: CollabClient | null; status: number }> {
    const socket = new WebSocket(
      `${baseUrl}/api/ws/page/${pageId}?windowId=test-window`,
      { headers },
    );
    socket.on("error", () => {});
    const client = new CollabClient(socket);
    const status = await new Promise<number>((resolve) => {
      socket.once("open", () => resolve(101));
      socket.once(
        "unexpected-response",
        (_request: unknown, response: IncomingMessage) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          socket.terminate();
        },
      );
    });
    if (status !== 101) return { client: null, status };
    openClients.add(client);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
    syncProtocol.writeSyncStep1(encoder, client.doc);
    client.send(encoding.toUint8Array(encoder));
    return { client, status };
  }

  /** Connects and waits for the first sync; fails unless it upgrades. */
  static async open(
    baseUrl: string,
    pageId: string,
    headers: Record<string, string>,
  ): Promise<CollabClient> {
    const { client, status } = await CollabClient.connect(
      baseUrl,
      pageId,
      headers,
    );
    if (!client) throw new Error(`Upgrade failed with ${status}`);
    await waitFor(() => client.synced && client.state(), {
      message: "the first sync",
    });
    return client;
  }

  send(data: Uint8Array | string) {
    if (this.socket.readyState === 1) this.socket.send(data);
  }

  private receive(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_TYPE.sync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
      const syncType = syncProtocol.readSyncMessage(
        decoder,
        encoder,
        this.doc,
        this,
      );
      if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (encoding.length(encoder) > 1) {
        this.send(encoding.toUint8Array(encoder));
      }
      return;
    }
    if (type === MESSAGE_TYPE.awareness) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
      for (const [clientId, state] of this.awareness.getStates()) {
        this.remoteStates.set(clientId, state);
      }
      return;
    }
    const control = decodeControl(data);
    if (control) this.controls.push(control);
  }

  /** Sets this client's awareness state and sends it. */
  setAwareness(state: Record<string, unknown> | null) {
    this.awareness.setLocalState(state);
    this.sendAwareness([this.doc.clientID]);
  }

  sendAwareness(clients: number[], states = this.awareness.getStates()) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE.awareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients, states),
    );
    this.send(encoding.toUint8Array(encoder));
  }

  /** Appends a paragraph with `text` to the document. */
  write(text: string) {
    const fragment = this.doc.getXmlFragment("default");
    this.doc.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText(text)]);
      fragment.insert(fragment.length, [paragraph]);
    });
  }

  markdown(): string {
    return jsonToMarkdown(yDocToJson(this.doc));
  }

  /** The latest control message of `kind`. */
  control<K extends ControlMessage["kind"]>(
    kind: K,
  ): Extract<ControlMessage, { kind: K }> | undefined {
    return this.controls.findLast((message) => message.kind === kind) as
      | Extract<ControlMessage, { kind: K }>
      | undefined;
  }

  state() {
    return this.control("state");
  }

  async closed(): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;
    const [code] = await once(this.socket, "close");
    return code as number;
  }
}
