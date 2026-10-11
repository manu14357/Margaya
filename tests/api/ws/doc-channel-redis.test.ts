import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: string[]) => void;
const listeners = new Map<string, Listener[]>();
const publish = vi.fn().mockResolvedValue(1);
const subscriber = {
  psubscribe: vi.fn().mockResolvedValue(undefined),
  punsubscribe: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((event: string, fn: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), fn]);
  }),
  off: vi.fn((event: string, fn: Listener) => {
    listeners.set(
      event,
      (listeners.get(event) ?? []).filter((listener) => listener !== fn),
    );
  }),
};

vi.mock("../../../apps/api/src/redis", () => ({
  isRedisConfigured: () => true,
  getRedisPub: () => ({ publish }),
  getRedisSub: () => subscriber,
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

import type { DocBroadcast } from "../../../apps/api/src/ws/broadcast-adapter";
import { RedisBroadcastAdapter } from "../../../apps/api/src/ws/redis-broadcast-adapter";

function emit(channel: string, payload: unknown) {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const listener of listeners.get("message") ?? [])
    listener(channel, data);
}

const message: DocBroadcast = {
  pageId: "page-1",
  origin: "instance-a",
  kind: "update",
  userId: "u1",
  data: Buffer.from([1, 2, 3]).toString("base64"),
};

beforeEach(() => {
  listeners.clear();
  vi.clearAllMocks();
});

describe("document channel over Redis", () => {
  it("subscribes one plain channel per loaded page and unsubscribes on unload", async () => {
    const adapter = new RedisBroadcastAdapter();
    await adapter.subscribeToDoc("page-1", () => {});
    await adapter.subscribeToDoc("page-1", () => {});
    await adapter.subscribeToDoc("page-2", () => {});
    expect(subscriber.subscribe.mock.calls).toEqual([
      ["margaya:ws-doc:page-1:broadcast"],
      ["margaya:ws-doc:page-2:broadcast"],
    ]);
    expect(subscriber.psubscribe).not.toHaveBeenCalled();

    await adapter.unsubscribeFromDoc("page-1");
    await adapter.unsubscribeFromDoc("page-1");
    expect(subscriber.unsubscribe.mock.calls).toEqual([
      ["margaya:ws-doc:page-1:broadcast"],
    ]);

    await adapter.shutdown();
    expect(subscriber.unsubscribe).toHaveBeenLastCalledWith(
      "margaya:ws-doc:page-2:broadcast",
    );
    expect(listeners.get("message")).toEqual([]);
  });

  it("publishes on the page's channel", async () => {
    const adapter = new RedisBroadcastAdapter();
    await adapter.publishDoc(message);
    expect(publish).toHaveBeenCalledWith(
      "margaya:ws-doc:page-1:broadcast",
      JSON.stringify(message),
    );
  });

  it("delivers valid messages and drops invalid or mismatched ones", async () => {
    const adapter = new RedisBroadcastAdapter();
    const received: DocBroadcast[] = [];
    await adapter.subscribeToDoc("page-1", (msg) => received.push(msg));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    emit("margaya:ws-doc:page-1:broadcast", message);
    emit("margaya:ws-doc:page-1:broadcast", { ...message, kind: "other" });
    emit("margaya:ws-doc:page-1:broadcast", { ...message, data: 42 });
    emit("margaya:ws-doc:page-1:broadcast", "{not json");
    // The payload's page must match the channel's.
    emit("margaya:ws-doc:page-1:broadcast", { ...message, pageId: "page-9" });
    // Pages this instance does not host, and other channels, are ignored.
    emit("margaya:ws-doc:page-2:broadcast", { ...message, pageId: "page-2" });
    emit("margaya:ws:project-1:broadcast", message);
    // Oversized data is dropped before parsing.
    emit("margaya:ws-doc:page-1:broadcast", {
      ...message,
      data: "A".repeat(8 * 1024 * 1024 + 1),
    });

    expect(received).toEqual([message]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    await adapter.shutdown();
  });
});

describe("document channel routing", () => {
  it("drops the instance's own messages and replies meant for another one", async () => {
    vi.resetModules();
    const ws = await import("../../../apps/api/src/ws/index");
    await ws.initializeWebSocketAdapter();
    const received: DocBroadcast[] = [];
    await ws.subscribeToDocBroadcasts("page-1", (msg) => received.push(msg));
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "margaya:ws-doc:page-1:broadcast",
    );

    ws.publishDocBroadcast({
      pageId: "page-1",
      kind: "sync-request",
      data: "AA==",
    });
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    const own = JSON.parse(
      publish.mock.calls[0]?.[1] as string,
    ) as DocBroadcast;
    expect(own.origin).toBeTruthy();

    emit("margaya:ws-doc:page-1:broadcast", own);
    emit("margaya:ws-doc:page-1:broadcast", {
      ...message,
      kind: "sync-reply",
      target: "someone-else",
    });
    emit("margaya:ws-doc:page-1:broadcast", {
      ...message,
      kind: "sync-reply",
      target: own.origin,
    });
    emit("margaya:ws-doc:page-1:broadcast", message);
    expect(received.map((msg) => msg.kind)).toEqual(["sync-reply", "update"]);

    await ws.unsubscribeFromDocBroadcasts("page-1");
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(
      "margaya:ws-doc:page-1:broadcast",
    );
    await ws.shutdownWebSocketAdapter();
  });
});
