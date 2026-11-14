import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { createElement, elementsMap } = await import(
  "../../../apps/api/src/whiteboard/board"
);
const { decodeControl, encodeAwarenessMessage, encodeSyncStep1, MESSAGE_TYPE } =
  await import("../../../apps/api/src/page/collab/protocol");
const { handleBoardBroadcast } = await import(
  "../../../apps/api/src/whiteboard/collab/fanout"
);
const { BoardConnection, WhiteboardRoom } = await import(
  "../../../apps/api/src/whiteboard/collab/room"
);

type Room = InstanceType<typeof WhiteboardRoom>;
type Deps = ConstructorParameters<typeof WhiteboardRoom>[1];
type Meta = Awaited<ReturnType<Deps["readMeta"]>> & { status: "ok" };

const BOARD_ID = "board-1";

const writer = {
  userId: "u1",
  canRead: true,
  canCreate: true,
  canUpdate: true,
  isManager: false,
};
const viewer = {
  ...writer,
  userId: "viewer",
  canCreate: false,
  canUpdate: false,
};

function meta(overrides = {}): Meta["meta"] {
  return {
    whiteboardId: BOARD_ID,
    workspaceId: "ws-1",
    projectId: "project-1",
    isLocked: false,
    archivedAt: null,
    contentVersion: 1,
    ...overrides,
  };
}

/** The stored board row. */
class FakeStore {
  state: Uint8Array = Y.encodeStateAsUpdate(new Y.Doc());
  meta = meta();
  persists = 0;

  async persist(input: Parameters<Deps["persist"]>[0]) {
    this.persists++;
    if (input.knownContentVersion !== this.meta.contentVersion) {
      Y.applyUpdate(input.doc, this.state, "db");
    }
    input.mutate?.(input.doc);
    this.state = Y.encodeStateAsUpdate(input.doc);
    this.meta = { ...this.meta, contentVersion: this.meta.contentVersion + 1 };
    const { whiteboardId, ...rest } = this.meta;
    return {
      status: "saved" as const,
      board: { id: whiteboardId, ...rest } as never,
      changed: true,
      contentVersion: this.meta.contentVersion,
    };
  }
}

function deps(store: FakeStore, overrides: Partial<Deps> = {}): Deps {
  const channel = {
    publish: vi.fn(),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
  };
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
    persist: vi.fn((input) => store.persist(input)),
    revalidate: vi.fn(async () => ({ status: "ok" as const, caller: writer })),
    channel,
    onDocBroadcast: (room, message) =>
      handleBoardBroadcast(room, message, channel),
    onClosed: vi.fn(),
    ...overrides,
  };
}

class FakeSocket {
  readonly frames: Uint8Array[] = [];
  readonly doc = new Y.Doc();
  closeCode: number | null = null;
  send = (data: Uint8Array) => {
    this.frames.push(data);
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarUint(decoder) !== MESSAGE_TYPE.sync) return;
    syncProtocol.readSyncMessage(
      decoder,
      encoding.createEncoder(),
      this.doc,
      "server",
    );
  };
  close = (code: number) => {
    this.closeCode ??= code;
  };
  controls() {
    return this.frames
      .map((frame) => decodeControl(frame))
      .filter((message) => message !== null);
  }
  control(kind: string) {
    return this.controls().findLast((message) => message?.kind === kind);
  }
  elements() {
    return elementsMap(this.doc).toJSON() as Record<string, { text?: string }>;
  }
}

const rooms: Room[] = [];

async function setup(overrides: Partial<Deps> = {}) {
  const store = new FakeStore();
  const roomDeps = deps(store, overrides);
  const room = new WhiteboardRoom(BOARD_ID, roomDeps);
  rooms.push(room);
  await room.ready;
  return { store, deps: roomDeps, room };
}

function connect(room: Room, caller = writer) {
  const socket = new FakeSocket();
  const connection = new BoardConnection(
    socket,
    {
      userId: caller.userId,
      name: `Name of ${caller.userId}`,
      image: null,
      workspaceId: "ws-1",
      sessionId: `session-${caller.userId}`,
      apiKeyId: null,
      apiKeyPermissions: null,
      initiatorId: caller.userId,
    },
    caller,
  );
  room.addConnection(connection);
  room.receive(connection, encodeSyncStep1(socket.doc));
  return { socket, connection };
}

/** A sync update frame for a change made to the client's doc. */
function change(doc: Y.Doc, mutate: (doc: Y.Doc) => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  mutate(doc);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_TYPE.sync);
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc, before));
  return encoding.toUint8Array(encoder);
}

function addSticky(doc: Y.Doc, text: string) {
  const sticky = createElement("sticky", { text, x: 10, y: 20 });
  return {
    sticky,
    frame: change(doc, (d) => elementsMap(d).set(sticky.id, sticky)),
  };
}

afterEach(() => {
  for (const room of rooms.splice(0)) room.close(1001, "test over");
});

describe("whiteboard room", () => {
  it("greets with the state control in the page room's shape", async () => {
    const { room } = await setup();
    const { socket } = connect(room);
    expect(socket.control("state")).toEqual({
      kind: "state",
      canWrite: true,
      isLocked: false,
      isArchived: false,
      access: "public",
      projectId: "project-1",
      contentVersion: 1,
    });
  });

  it("makes two clients converge", async () => {
    const { room } = await setup();
    const alice = connect(room);
    const bob = connect(room);
    const one = addSticky(alice.socket.doc, "from alice");
    room.receive(alice.connection, one.frame);
    const two = addSticky(bob.socket.doc, "from bob");
    room.receive(bob.connection, two.frame);

    for (const socket of [alice.socket, bob.socket]) {
      const elements = socket.elements();
      expect(elements[one.sticky.id]?.text).toBe("from alice");
      expect(elements[two.sticky.id]?.text).toBe("from bob");
    }
    expect(Object.keys(elementsMap(room.doc).toJSON())).toHaveLength(2);
    expect(room.isDirty).toBe(true);
  });

  it("never applies a viewer's edits and tells them once", async () => {
    const { room } = await setup();
    const editor = connect(room);
    const reader = connect(room, viewer);
    expect(reader.socket.control("state")).toMatchObject({ canWrite: false });

    room.receive(reader.connection, addSticky(reader.socket.doc, "nope").frame);
    room.receive(
      reader.connection,
      addSticky(reader.socket.doc, "again").frame,
    );
    expect(elementsMap(room.doc).size).toBe(0);
    expect(Object.keys(editor.socket.elements())).toHaveLength(0);
    const notices = reader.socket
      .controls()
      .filter((message) => message?.kind === "offline-rejected");
    expect(notices).toEqual([{ kind: "offline-rejected", reason: "readOnly" }]);
    expect(reader.socket.closeCode).toBeNull();
  });

  it("closes write access once the board is locked", async () => {
    const { store, room } = await setup();
    const editor = connect(room);
    store.meta = { ...store.meta, isLocked: true };
    await room.refresh();
    expect(editor.socket.control("state")).toMatchObject({
      canWrite: false,
      isLocked: true,
    });
    room.receive(editor.connection, addSticky(editor.socket.doc, "late").frame);
    expect(elementsMap(room.doc).size).toBe(0);
    expect(editor.socket.control("offline-rejected")).toEqual({
      kind: "offline-rejected",
      reason: "locked",
    });
  });

  it("strips invalid elements and repairs bad fields for everyone", async () => {
    const { room } = await setup();
    const alice = connect(room);
    const bob = connect(room);
    const good = createElement("rectangle", { x: 1 });
    room.receive(
      alice.connection,
      change(alice.socket.doc, (doc) => {
        const map = doc.getMap<unknown>("elements");
        map.set("junk", { id: "junk", type: "iframe" });
        map.set(good.id, { ...good, link: "javascript:alert(1)", extra: 1 });
      }),
    );

    for (const doc of [room.doc, alice.socket.doc, bob.socket.doc]) {
      const map = doc.getMap<Record<string, unknown>>("elements");
      expect(map.has("junk")).toBe(false);
      expect(map.get(good.id)).toMatchObject({ id: good.id, link: null });
      expect(map.get(good.id)).not.toHaveProperty("extra");
      expect(map.get(good.id)?.version).toBe(good.version + 1);
    }
    expect(alice.socket.closeCode).toBeNull();
  });

  it("closes a connection that sends nested types or other roots", async () => {
    const { room } = await setup();
    const alice = connect(room);
    room.receive(
      alice.connection,
      change(alice.socket.doc, (doc) =>
        doc.getMap("elements").set("x", new Y.Map()),
      ),
    );
    expect(alice.socket.closeCode).toBe(1008);
    expect(elementsMap(room.doc).size).toBe(0);
  });

  it("persists the content and announces the save", async () => {
    const { store, room } = await setup();
    const alice = connect(room);
    const { sticky, frame } = addSticky(alice.socket.doc, "saved");
    room.receive(alice.connection, frame);
    await room.flush();
    expect(store.persists).toBe(1);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, store.state);
    expect(elementsMap(stored).get(sticky.id)?.text).toBe("saved");
    expect(alice.socket.control("saved")).toMatchObject({ contentVersion: 2 });
    expect(room.isDirty).toBe(false);
  });

  it("names everyone whose edits a save holds, once per save", async () => {
    const { deps: roomDeps, room } = await setup();
    const alice = connect(room);
    const bob = connect(room, { ...writer, userId: "u2" });
    room.receive(alice.connection, addSticky(alice.socket.doc, "a").frame);
    room.receive(bob.connection, addSticky(bob.socket.doc, "b").frame);
    room.receive(alice.connection, addSticky(alice.socket.doc, "c").frame);
    await room.flush();
    const persist = vi.mocked(roomDeps.persist);
    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({
      actorId: "u1",
      contributorIds: ["u1", "u2"],
    });

    room.receive(bob.connection, addSticky(bob.socket.doc, "d").frame);
    await room.flush();
    expect(persist.mock.calls.at(-1)?.[0].contributorIds).toEqual(["u2"]);
  });

  it("applies server changes through the live doc", async () => {
    const { store, room } = await setup();
    const alice = connect(room);
    const sticky = createElement("sticky", { text: "from MCP" });
    const result = await room.applyServerChange({
      actorId: "u1",
      mutate: (doc) => elementsMap(doc).set(sticky.id, sticky),
    });
    expect(result).toEqual({ contentVersion: 2 });
    expect(alice.socket.elements()[sticky.id]?.text).toBe("from MCP");
    expect(store.persists).toBe(1);
  });

  it("replaces awareness names with the account's", async () => {
    const { room } = await setup();
    const alice = connect(room);
    const clientDoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(clientDoc);
    awareness.setLocalState({
      user: { id: "u1", name: "Someone Else", color: "#ff0000", image: null },
      cursor: { x: 1, y: 2 },
    });
    room.receive(
      alice.connection,
      encodeAwarenessMessage(
        awarenessProtocol.encodeAwarenessUpdate(awareness, [
          clientDoc.clientID,
        ]),
      ),
    );
    expect(room.awareness.getStates().get(clientDoc.clientID)).toMatchObject({
      user: { id: "u1", name: "Name of u1" },
      cursor: { x: 1, y: 2 },
    });
  });

  it("closes with 4404 when the board is gone on refresh", async () => {
    const { room } = await setup({
      readMeta: vi.fn(async () => ({ status: "gone" as const })),
    });
    const alice = connect(room);
    await room.refresh();
    expect(alice.socket.closeCode).toBe(4404);
    expect(room.isClosed).toBe(true);
  });
});
