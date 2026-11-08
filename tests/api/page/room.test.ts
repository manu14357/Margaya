import { afterEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { LoadResult } from "../../../apps/api/src/page/collab/meta";
import {
  encodeAwarenessMessage,
  encodeSyncStep1,
} from "../../../apps/api/src/page/collab/protocol";
import type { PageRoom } from "../../../apps/api/src/page/collab/room";
import { PageTooLargeError } from "../../../apps/api/src/page/persistence";
import {
  connect,
  edit,
  FakeBus,
  FakeStore,
  newRoom,
  reader,
  roomDeps,
  settle,
  text,
  writer,
} from "./collab-fakes";

const rooms: PageRoom[] = [];

function setup(content = "base", overrides = {}) {
  const store = new FakeStore(content);
  const bus = new FakeBus();
  const deps = roomDeps(store, bus.channelFor("A"), overrides);
  const room = newRoom(deps);
  rooms.push(room);
  return { store, deps, room };
}

afterEach(() => {
  vi.useRealTimers();
  for (const room of rooms.splice(0)) room.close(1001, "test over");
});

describe("page room connections", () => {
  it("greets with sync step 1, awareness and the state control", async () => {
    const { room } = setup();
    await room.ready;
    const { socket, connection } = connect(room);
    expect(socket.frames.length).toBe(2);
    expect(socket.control("state")).toMatchObject({
      canWrite: true,
      isLocked: false,
      contentVersion: 1,
    });
    room.receive(connection, encodeSyncStep1(socket.doc));
    expect(text(socket.doc)).toBe("base");
  });

  it("queues frames received while loading and replays them in order", async () => {
    let release: (value: LoadResult) => void = () => {};
    const store = new FakeStore("late");
    const { room } = setup("", {
      load: () =>
        new Promise<LoadResult>((resolve) => {
          release = resolve;
        }),
    });
    const { socket, connection } = connect(room);
    room.receive(connection, encodeSyncStep1(socket.doc));
    expect(socket.frames).toHaveLength(0);
    release({ status: "ok", meta: store.meta, state: store.state });
    await room.ready;
    expect(socket.control("state")).toBeDefined();
    expect(text(socket.doc)).toBe("late");
  });

  it("closes a room's 101st connection with 4429", async () => {
    const { room } = setup();
    await room.ready;
    for (let index = 0; index < 100; index++) connect(room);
    const { socket } = connect(room);
    expect(socket.closeCode).toBe(4429);
    expect(room.connections.size).toBe(100);
  });

  it("closes a connection over 1,000 messages in 10 s with 4529", async () => {
    const { room } = setup();
    await room.ready;
    const { socket, connection } = connect(room);
    const frame = encodeSyncStep1(new Y.Doc());
    for (let index = 0; index < 1000; index++) room.receive(connection, frame);
    expect(socket.closeCode).toBeNull();
    room.receive(connection, frame);
    expect(socket.closeCode).toBe(4529);
  });

  it("closes a connection that sends a control message or garbage with 1008", async () => {
    const { room } = setup();
    await room.ready;
    const control = connect(room);
    room.receive(control.connection, new Uint8Array([100, 2, 123, 125]));
    expect(control.socket.closeCode).toBe(1008);
    const garbage = connect(room);
    room.receive(garbage.connection, new Uint8Array([0, 2, 5, 1]));
    expect(garbage.socket.closeCode).toBe(1008);
  });

  it("removes a closed connection's presence for everyone", async () => {
    const { room } = setup();
    await room.ready;
    const alice = connect(room);
    const bob = connect(room);
    const aliceDoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(aliceDoc);
    awareness.setLocalState({ user: { id: "u1", color: "amber" } });
    room.receive(
      alice.connection,
      encodeAwarenessMessage(
        awarenessProtocol.encodeAwarenessUpdate(awareness, [aliceDoc.clientID]),
      ),
    );
    expect(room.awareness.getStates().has(aliceDoc.clientID)).toBe(true);
    // The sender gets its own state back (the client's watchdog needs it).
    const echoes = alice.socket.frames.filter((frame) => frame[0] === 1);
    expect(echoes.length).toBe(1);
    const before = bob.socket.frames.length;
    room.removeConnection(alice.connection);
    expect(room.awareness.getStates().has(aliceDoc.clientID)).toBe(false);
    expect(bob.socket.frames.length).toBe(before + 1);
    awareness.destroy();
  });
});

describe("page room writes", () => {
  it("never applies a read-only connection's update, and tells it once a minute", async () => {
    const { room } = setup();
    await room.ready;
    const viewer = connect(room, reader);
    expect(viewer.socket.control("state")?.canWrite).toBe(false);
    const viewerDoc = new Y.Doc();
    Y.applyUpdate(viewerDoc, Y.encodeStateAsUpdate(room.doc));
    room.receive(viewer.connection, edit(viewerDoc, " nope"));
    room.receive(viewer.connection, edit(viewerDoc, " again"));
    expect(text(room.doc)).toBe("base");
    const rejected = viewer.socket
      .controls()
      .filter((message) => message.kind === "offline-rejected");
    expect(rejected).toEqual([
      { kind: "offline-rejected", reason: "readOnly" },
    ]);
    expect(room.isDirty).toBe(false);
  });

  it("persists right away when the last connection leaves", async () => {
    const { room, store } = setup();
    await room.ready;
    const alice = connect(room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(room.doc));
    room.receive(alice.connection, edit(aliceDoc, " typed"));
    expect(room.isDirty).toBe(true);
    expect(store.persists).toBe(0);
    room.removeConnection(alice.connection);
    await settle();
    expect(store.persists).toBe(1);
    expect(room.isDirty).toBe(false);
  });

  it("sends saved after each persist and save-error after the second failure", async () => {
    vi.useFakeTimers();
    const { room, store } = setup();
    await room.ready;
    const alice = connect(room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(room.doc));
    store.failNext = 2;
    room.receive(alice.connection, edit(aliceDoc, "1"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(alice.socket.control("save-error")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(alice.socket.control("save-error")).toBeDefined();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(alice.socket.control("saved")).toMatchObject({ contentVersion: 2 });
    expect(room.isDirty).toBe(false);
  });

  it("closes everyone with 4413 when the document grows too large", async () => {
    const { room, store } = setup();
    await room.ready;
    const alice = connect(room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(room.doc));
    room.receive(alice.connection, edit(aliceDoc, "big"));
    store.error = new PageTooLargeError(6 * 1024 * 1024);
    await room.flush();
    expect(alice.socket.control("too-large")).toEqual({
      kind: "too-large",
      limitBytes: 5 * 1024 * 1024,
    });
    expect(alice.socket.closeCode).toBe(4413);
    expect(room.isClosed).toBe(true);
  });
});

describe("page room meta", () => {
  it("follows lock and access changes per connection", async () => {
    const { room, store } = setup();
    await room.ready;
    const alice = connect(room);
    const owner = connect(room, { ...writer, userId: "owner" });
    room.applyMeta({ ...store.meta, isLocked: true });
    expect(alice.socket.control("state")).toMatchObject({
      canWrite: false,
      isLocked: true,
    });
    room.applyMeta({ ...store.meta, access: "private" });
    expect(alice.socket.closeCode).toBe(4403);
    expect(owner.socket.closeCode).toBeNull();
    expect(owner.socket.control("state")).toMatchObject({
      canWrite: true,
      access: "private",
    });
  });

  it("closes connections whose revalidation fails", async () => {
    const { room, deps } = setup();
    await room.ready;
    const alice = connect(room);
    vi.mocked(deps.revalidate).mockResolvedValueOnce({
      status: "close",
      code: 4401,
      reason: "Session ended",
    });
    await room.revalidateAll();
    expect(alice.socket.closeCode).toBe(4401);
  });

  it("keeps the newest check's role when an older check finishes last", async () => {
    const { room, deps } = setup();
    await room.ready;
    const alice = connect(room);
    // The timer's check read the old role and is slow; a page event's check,
    // started after it, read the new one and answers first.
    let finishOld: (caller: typeof writer) => void = () => {};
    vi.mocked(deps.revalidate)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = (caller) => resolve({ status: "ok", caller });
          }),
      )
      .mockResolvedValueOnce({
        status: "ok",
        caller: { ...reader, userId: writer.userId },
      });

    const periodic = room.revalidateAll();
    await room.revalidateAll();
    expect(alice.connection.caller.canUpdate).toBe(false);
    expect(alice.socket.control("state")).toMatchObject({ canWrite: false });

    finishOld(writer);
    await periodic;
    expect(alice.connection.caller.canUpdate).toBe(false);
    expect(alice.connection.canWrite).toBe(false);
    expect(alice.socket.control("state")).toMatchObject({ canWrite: false });
  });

  it("still applies an older check that finishes before the newer one", async () => {
    const { room, deps } = setup();
    await room.ready;
    const alice = connect(room);
    let finishNew: (caller: typeof writer) => void = () => {};
    vi.mocked(deps.revalidate)
      .mockResolvedValueOnce({
        status: "ok",
        caller: { ...reader, userId: writer.userId },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = (caller) => resolve({ status: "ok", caller });
          }),
      );

    const first = room.revalidateAll();
    const second = room.revalidateAll();
    await first;
    expect(alice.connection.canWrite).toBe(false);
    finishNew(writer);
    await second;
    expect(alice.connection.canWrite).toBe(true);
  });

  it("closes with 4404 when the page is gone at load", async () => {
    const { room } = setup("", {
      load: async () => ({ status: "gone" as const }),
    });
    const { socket } = connect(room);
    expect(await room.ready).toBe(false);
    expect(socket.closeCode).toBe(4404);
  });
});
