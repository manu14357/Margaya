import { afterEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { encodeAwarenessMessage } from "../../../apps/api/src/page/collab/protocol";
import type { PageRoom } from "../../../apps/api/src/page/collab/room";
import {
  connect,
  edit,
  FakeBus,
  FakeStore,
  newRoom,
  PAGE_ID,
  roomDeps,
  settle,
  text,
} from "./collab-fakes";

const rooms: PageRoom[] = [];

function instance(store: FakeStore, bus: FakeBus, id: string) {
  const deps = roomDeps(store, bus.channelFor(id));
  const room = newRoom(deps);
  rooms.push(room);
  return { room, deps };
}

afterEach(() => {
  for (const room of rooms.splice(0)) room.close(1001, "test over");
});

describe("document channel between instances", () => {
  it("propagates updates both ways and marks the receiving room dirty", async () => {
    const store = new FakeStore("base");
    const bus = new FakeBus();
    const a = instance(store, bus, "A");
    const b = instance(store, bus, "B");
    await Promise.all([a.room.ready, b.room.ready]);
    expect(bus.subscribers(PAGE_ID).sort()).toEqual(["A", "B"]);

    const alice = connect(a.room);
    const bob = connect(b.room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(a.room.doc));
    a.room.receive(alice.connection, edit(aliceDoc, " from A"));
    await settle();
    expect(text(b.room.doc)).toBe("base from A");
    // B's local socket got it as a sync update.
    expect(bob.socket.frames.length).toBeGreaterThan(0);
    expect(b.room.isDirty).toBe(true);
    // The remote update is never published again by B.
    const updates = bus.sent.filter((message) => message.kind === "update");
    expect(updates.map((message) => message.origin)).toEqual(["A"]);
    expect(updates[0]?.userId).toBe("u1");
  });

  it("heals a dropped update through the sync request of a later room", async () => {
    const store = new FakeStore("base");
    const bus = new FakeBus();
    const a = instance(store, bus, "A");
    await a.room.ready;
    const alice = connect(a.room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(a.room.doc));
    a.room.receive(alice.connection, edit(aliceDoc, " unsaved"));

    // B loads from the store, which lacks A's unsaved edit.
    const b = instance(store, bus, "B");
    await b.room.ready;
    await settle();
    expect(text(b.room.doc)).toBe("base unsaved");
    const reply = bus.sent.find((message) => message.kind === "sync-reply");
    expect(reply).toMatchObject({ origin: "A", target: "B" });
  });

  it("heals a dropped update through the database pull of the next persist", async () => {
    const store = new FakeStore("base");
    const bus = new FakeBus();
    const a = instance(store, bus, "A");
    const b = instance(store, bus, "B");
    await Promise.all([a.room.ready, b.room.ready]);
    await settle();
    bus.drop = true;

    const alice = connect(a.room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(a.room.doc));
    a.room.receive(alice.connection, edit(aliceDoc, " lost"));
    await a.room.flush();
    expect(text(b.room.doc)).toBe("base");

    const bob = connect(b.room);
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(b.room.doc));
    b.room.receive(bob.connection, edit(bobDoc, "!"));
    await b.room.flush();
    expect(text(b.room.doc)).toContain(" lost");
    expect(text(b.room.doc)).toContain("!");
    // The store holds both.
    const stored = new Y.Doc();
    Y.applyUpdate(stored, store.state);
    expect(text(stored)).toBe(text(b.room.doc));
  });

  it("closes and unloads on a deleted meta, without persisting", async () => {
    const store = new FakeStore("base");
    const bus = new FakeBus();
    const a = instance(store, bus, "A");
    const b = instance(store, bus, "B");
    await Promise.all([a.room.ready, b.room.ready]);
    const bob = connect(b.room);
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(b.room.doc));
    b.room.receive(bob.connection, edit(bobDoc, " doomed"));
    const persists = store.persists;

    bus
      .channelFor("A")
      .publish({ pageId: PAGE_ID, kind: "meta", deleted: true });
    await settle();
    expect(bob.socket.closeCode).toBe(4404);
    expect(b.room.isClosed).toBe(true);
    expect(b.deps.onClosed).toHaveBeenCalledWith(b.room);
    expect(store.persists).toBe(persists);
    expect(bus.subscribers(PAGE_ID)).toEqual(["A"]);
  });

  it("refreshes from the database on a meta message", async () => {
    const store = new FakeStore("base");
    const bus = new FakeBus();
    const a = instance(store, bus, "A");
    const b = instance(store, bus, "B");
    await Promise.all([a.room.ready, b.room.ready]);
    const bob = connect(b.room);
    store.meta = { ...store.meta, isLocked: true };
    bus.channelFor("A").publish({ pageId: PAGE_ID, kind: "meta" });
    await settle();
    expect(b.deps.readMeta).toHaveBeenCalled();
    expect(bob.socket.control("state")).toMatchObject({
      canWrite: false,
      isLocked: true,
    });
  });

  it("answers awareness queries with local connections' states only", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const a = instance(store, bus, "A");
    await a.room.ready;
    const alice = connect(a.room);
    const aliceDoc = new Y.Doc();
    const aliceAwareness = new awarenessProtocol.Awareness(aliceDoc);
    aliceAwareness.setLocalState({ user: { id: "u1", color: "blue" } });
    a.room.receive(
      alice.connection,
      encodeAwarenessMessage(
        awarenessProtocol.encodeAwarenessUpdate(aliceAwareness, [
          aliceDoc.clientID,
        ]),
      ),
    );
    await settle();

    // B learns Alice's state from A, then C asks around.
    const b = instance(store, bus, "B");
    await b.room.ready;
    await settle();
    expect(b.room.awareness.getStates().has(aliceDoc.clientID)).toBe(true);
    bus.sent.length = 0;
    const c = instance(store, bus, "C");
    await c.room.ready;
    await settle();
    const replies = bus.sent.filter(
      (message) => message.kind === "awareness" && message.target === "C",
    );
    expect(replies.map((message) => message.origin)).toEqual(["A"]);
    expect(c.room.awareness.getStates().get(aliceDoc.clientID)).toEqual({
      user: { id: "u1", color: "blue" },
    });
    aliceAwareness.destroy();
  });

  it("the in-process channel of a single instance never loops back", async () => {
    const store = new FakeStore("base");
    const publish = vi.fn();
    const deps = roomDeps(store, {
      publish,
      subscribe: async () => {},
      unsubscribe: async () => {},
    });
    const room = newRoom(deps);
    rooms.push(room);
    await room.ready;
    const alice = connect(room);
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(room.doc));
    room.receive(alice.connection, edit(aliceDoc, "!"));
    await settle();
    expect(text(room.doc)).toBe("base!");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "update", pageId: PAGE_ID }),
    );
  });
});
