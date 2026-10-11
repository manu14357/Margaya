import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { vi } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  type CollabSocket,
  PageConnection,
} from "../../../apps/api/src/page/collab/connection";
import { handleDocBroadcast } from "../../../apps/api/src/page/collab/fanout";
import type { PageMeta } from "../../../apps/api/src/page/collab/meta";
import {
  type ControlMessage,
  decodeControl,
  MESSAGE_TYPE,
} from "../../../apps/api/src/page/collab/protocol";
import {
  type DocChannel,
  PageRoom,
  type RoomDeps,
} from "../../../apps/api/src/page/collab/room";
import type { PersistInput } from "../../../apps/api/src/page/persistence";
import type { PageCaller } from "../../../apps/api/src/page/rules";
import type { DocBroadcast } from "../../../apps/api/src/ws/broadcast-adapter";

// Rooms without a database or sockets: a fake row store, a fake document
// channel that behaves like Redis pub/sub between instances, and sockets
// that record what they were sent.

export const PAGE_ID = "page-1";

export function meta(overrides: Partial<PageMeta> = {}): PageMeta {
  return {
    pageId: PAGE_ID,
    workspaceId: "ws-1",
    projectId: "project-1",
    access: "public",
    ownerId: "owner",
    isLocked: false,
    archivedAt: null,
    contentVersion: 1,
    ...overrides,
  };
}

export const writer: PageCaller = {
  userId: "u1",
  canRead: true,
  canCreate: true,
  canUpdate: true,
  isManager: false,
};

export const reader: PageCaller = {
  userId: "viewer",
  canRead: true,
  canCreate: false,
  canUpdate: false,
  isManager: false,
};

/** The stored page row shared by every instance. */
export class FakeStore {
  state: Uint8Array;
  meta: PageMeta;
  persists = 0;
  failNext = 0;
  error: Error | null = null;

  constructor(text = "") {
    const doc = new Y.Doc();
    if (text) doc.getText("t").insert(0, text);
    this.state = Y.encodeStateAsUpdate(doc);
    this.meta = meta();
  }

  async persist(input: PersistInput) {
    this.persists++;
    if (this.error) throw this.error;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("database down");
    }
    if (input.knownContentVersion !== this.meta.contentVersion) {
      Y.applyUpdate(input.doc, this.state, "db");
    }
    input.mutate?.(input.doc);
    this.state = Y.encodeStateAsUpdate(input.doc);
    this.meta = { ...this.meta, contentVersion: this.meta.contentVersion + 1 };
    const { pageId, ...rest } = this.meta;
    return {
      status: "saved" as const,
      page: { id: pageId, ...rest } as never,
      changed: true,
      contentVersion: this.meta.contentVersion,
      newlyMentionedUserIds: [],
    };
  }
}

/** Pub/sub between fake instances; can drop messages like a lossy link. */
export class FakeBus {
  drop = false;
  readonly sent: DocBroadcast[] = [];
  private readonly handlers = new Map<
    string,
    Map<string, (message: DocBroadcast) => void>
  >();

  channelFor(instanceId: string): DocChannel {
    return {
      publish: (message) => {
        const full = { ...message, origin: instanceId };
        this.sent.push(full);
        if (this.drop) return;
        for (const [id, handler] of this.handlers.get(message.pageId) ?? []) {
          if (id === instanceId) continue;
          if (full.target && full.target !== id) continue;
          queueMicrotask(() => handler(full));
        }
      },
      subscribe: async (pageId, handler) => {
        const byInstance = this.handlers.get(pageId) ?? new Map();
        byInstance.set(instanceId, handler);
        this.handlers.set(pageId, byInstance);
      },
      unsubscribe: async (pageId) => {
        this.handlers.get(pageId)?.delete(instanceId);
      },
    };
  }

  subscribers(pageId: string): string[] {
    return [...(this.handlers.get(pageId)?.keys() ?? [])];
  }
}

export function roomDeps(
  store: FakeStore,
  channel: DocChannel,
  overrides: Partial<RoomDeps> = {},
): RoomDeps {
  return {
    load: vi.fn(async () => ({
      status: "ok" as const,
      meta: { ...store.meta },
      state: store.state,
    })),
    readMeta: vi.fn(async () => ({
      status: "ok" as const,
      meta: { ...store.meta },
    })),
    persist: vi.fn((input: PersistInput) => store.persist(input)),
    revalidate: vi.fn(async () => ({ status: "ok" as const, caller: writer })),
    channel,
    onDocBroadcast: (room, message) =>
      handleDocBroadcast(room, message, channel),
    onClosed: vi.fn(),
    ...overrides,
  };
}

/** A socket that records frames and keeps a client doc in sync. */
export class FakeSocket implements CollabSocket {
  readonly frames: Uint8Array[] = [];
  readonly doc = new Y.Doc();
  closeCode: number | null = null;
  send = (data: Uint8Array) => {
    this.frames.push(data);
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarUint(decoder) !== MESSAGE_TYPE.sync) return;
    const encoder = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, "server");
  };
  close = (code: number) => {
    this.closeCode ??= code;
  };

  controls(): ControlMessage[] {
    return this.frames
      .map((frame) => decodeControl(frame))
      .filter((message): message is ControlMessage => message !== null);
  }

  control<K extends ControlMessage["kind"]>(kind: K) {
    return this.controls().findLast((message) => message.kind === kind) as
      | Extract<ControlMessage, { kind: K }>
      | undefined;
  }
}

export function connect(
  room: PageRoom,
  caller: PageCaller = writer,
): { socket: FakeSocket; connection: PageConnection } {
  const socket = new FakeSocket();
  const connection = new PageConnection(
    socket,
    {
      userId: caller.userId,
      workspaceId: "ws-1",
      sessionId: `session-${caller.userId}`,
      apiKeyId: null,
      apiKeyPermissions: null,
      initiatorId: caller.userId,
    },
    caller,
  );
  room.addConnection(connection);
  return { socket, connection };
}

/** A sync update frame for text appended to `doc`'s "t". */
export function edit(doc: Y.Doc, text: string): Uint8Array {
  const before = Y.encodeStateVector(doc);
  doc.getText("t").insert(doc.getText("t").length, text);
  const update = Y.encodeStateAsUpdate(doc, before);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function text(doc: Y.Doc) {
  return doc.getText("t").toString();
}

/** Lets queued microtasks and promise chains settle. */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function newRoom(deps: RoomDeps, pageId = PAGE_ID) {
  return new PageRoom(pageId, deps);
}
