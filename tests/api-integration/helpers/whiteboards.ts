import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { expect } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import {
  type ControlMessage,
  decodeControl,
  MESSAGE_TYPE,
} from "../../../apps/api/src/page/collab/protocol";
import {
  type BoardElement,
  createElement,
  elementsMap,
} from "../../../apps/api/src/whiteboard/board";
import { addPerson } from "./assignees";
import { mockAuthenticatedSession } from "./auth";
import { WebSocket, waitFor } from "./collab";
import { json } from "./cycles";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";

export { json } from "./cycles";
export { createElement, elementsMap };

type User = typeof schema.userTable.$inferSelect;

export type WhiteboardJson = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  icon: string | null;
  isLocked: boolean;
  lockedBy: { id: string; name: string } | null;
  archivedAt: string | null;
  publicToken: string | null;
  publishedAt: string | null;
  elementCount: number;
  contentVersion: number;
  createdBy: { id: string; name: string; image: string | null } | null;
  updatedBy: { id: string; name: string; image: string | null } | null;
  capabilities: {
    canEdit: boolean;
    canManage: boolean;
    canPublish: boolean;
    canDuplicate: boolean;
  };
};

export type ContentJson = {
  elements: Array<Record<string, unknown> & { id: string; type: string }>;
  settings: { background: string; gridSize: number };
  contentVersion: number;
};

export async function boardRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.whiteboardTable)
    .where(eq(schema.whiteboardTable.id, id));
  return row;
}

export async function setWhiteboardsEnabled(
  projectId: string,
  enabled: boolean,
) {
  await db
    .update(schema.projectTable)
    .set({ whiteboardsEnabled: enabled })
    .where(eq(schema.projectTable.id, projectId));
}

export async function allowPublicPages(workspaceId: string, value: boolean) {
  await db
    .update(schema.workspaceTable)
    .set({ allowPublicPages: value })
    .where(eq(schema.workspaceTable.id, workspaceId));
}

export async function insertTask(
  projectId: string,
  title: string,
  number = 1,
): Promise<typeof schema.taskTable.$inferSelect> {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, number, status: "to-do" })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

export function sticky(text: string, props: Partial<BoardElement> = {}) {
  return createElement("sticky", { text, ...props } as never) as BoardElement;
}

export function taskCard(taskId: string) {
  return createElement("task", { taskId } as never) as BoardElement;
}

/**
 * A workspace with an owner (Olivia), an admin (Ada), members Ben and Cara,
 * a viewer (Vic) and a project "web". `call` sends a request to /api/... as
 * the given user (paths are relative to /api).
 */
export async function whiteboardScene() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia",
  });
  const workspaceId = owner.workspace.id;
  const admin = await addPerson(workspaceId, "Ada", "admin");
  const ben = await addPerson(workspaceId, "Ben", "member");
  const cara = await addPerson(workspaceId, "Cara", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");
  const { project } = await createProjectFixture({
    workspaceId,
    slug: `web${randomUUID().slice(0, 4)}`,
  });
  const { app } = createApp();

  const call = (user: User, path: string, init?: RequestInit) => {
    mockAuthenticatedSession(user);
    return app.request(`/api${path}`, init);
  };

  const ok = async <T = WhiteboardJson>(
    user: User,
    path: string,
    init?: RequestInit,
    status = 200,
  ): Promise<T> => {
    const response = await call(user, path, init);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };

  const create = (
    user: User,
    body: Record<string, unknown> = {},
    projectId = project.id,
  ) =>
    ok<WhiteboardJson>(
      user,
      "/whiteboard",
      json("POST", { projectId, ...body }),
      201,
    );

  const content = (user: User, id: string) =>
    ok<ContentJson>(user, `/whiteboard/${id}/content`);

  /** Archives then trashes a board as `user`. */
  const trash = async (user: User, id: string) => {
    await ok(user, `/whiteboard/${id}/archive`, { method: "POST" });
    return ok(user, `/whiteboard/${id}`, { method: "DELETE" });
  };

  return {
    app,
    workspaceId,
    project,
    owner: owner.user,
    admin,
    ben,
    cara,
    viewer,
    call,
    ok,
    create,
    content,
    trash,
  };
}

export type WhiteboardScene = Awaited<ReturnType<typeof whiteboardScene>>;

type Socket = InstanceType<typeof WebSocket>;

/** A minimal board-socket client: the page socket's protocol on /ws/whiteboard. */
export class BoardClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly controls: ControlMessage[] = [];
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

  static async connect(
    baseUrl: string,
    whiteboardId: string,
    headers: Record<string, string>,
  ): Promise<{ client: BoardClient | null; status: number }> {
    const socket = new WebSocket(
      `${baseUrl}/api/ws/whiteboard/${whiteboardId}?windowId=test-window`,
      { headers },
    );
    socket.on("error", () => {});
    const client = new BoardClient(socket);
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
    openBoardClients.add(client);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
    syncProtocol.writeSyncStep1(encoder, client.doc);
    client.send(encoding.toUint8Array(encoder));
    return { client, status };
  }

  static async open(
    baseUrl: string,
    whiteboardId: string,
    headers: Record<string, string>,
  ): Promise<BoardClient> {
    const { client, status } = await BoardClient.connect(
      baseUrl,
      whiteboardId,
      headers,
    );
    if (!client) throw new Error(`Upgrade failed with ${status}`);
    await waitFor(() => client.synced && client.control("state"), {
      message: "the first sync",
    });
    return client;
  }

  send(data: Uint8Array) {
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
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this,
      );
      return;
    }
    const control = decodeControl(data);
    if (control) this.controls.push(control);
  }

  /** Writes raw values into the elements map (valid or not). */
  put(key: string, value: unknown) {
    this.doc.getMap<unknown>("elements").set(key, value);
  }

  element(id: string) {
    return this.doc.getMap<Record<string, unknown>>("elements").get(id);
  }

  control<K extends ControlMessage["kind"]>(
    kind: K,
  ): Extract<ControlMessage, { kind: K }> | undefined {
    return this.controls.findLast((message) => message.kind === kind) as
      | Extract<ControlMessage, { kind: K }>
      | undefined;
  }
}

const openBoardClients = new Set<BoardClient>();

export function terminateBoardClients() {
  for (const client of openBoardClients) client.socket.terminate();
  openBoardClients.clear();
}
