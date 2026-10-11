import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventContext, publishEvent } from "../../../apps/api/src/events";
import {
  addUserConnection,
  initializeWebSocketAdapter,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";
import { originWindowId } from "../../../apps/api/src/ws/origin-window";

type FakeWs = { send: ReturnType<typeof vi.fn> };

function makeFakeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

function lastMessage(ws: unknown) {
  const calls = (ws as FakeWs).send.mock.calls;
  return JSON.parse(calls[calls.length - 1]?.[0] ?? "null");
}

describe("originWindowId", () => {
  it("takes the window id after the caller's own user id", () => {
    expect(originWindowId("user-1", "user-1:abc123")).toBe("abc123");
  });

  it("is null without a window, for another user, or when malformed", () => {
    expect(originWindowId("user-1", undefined)).toBeNull();
    expect(originWindowId("user-1", "user-1")).toBeNull();
    expect(originWindowId("user-1", "user-2:abc")).toBeNull();
    expect(originWindowId("user-1", "user-1:")).toBeNull();
    expect(originWindowId("user-1", "user-1:a b")).toBeNull();
    expect(originWindowId("user-1", `user-1:${"a".repeat(65)}`)).toBeNull();
  });
});

describe("home user-channel events", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each([
    [
      "sticky.changed",
      "STICKIES_UPDATED",
      { stickyId: "s1", action: "updated" },
    ],
    [
      "quick_link.changed",
      "QUICK_LINKS_UPDATED",
      { quickLinkId: "q1", action: "created" },
    ],
    ["home_preferences.changed", "HOME_PREFERENCES_UPDATED", {}],
  ])(
    "maps %s to %s for the owner only, with the origin window",
    async (eventName, type, extra) => {
      const mine = makeFakeWs();
      const other = makeFakeWs();
      const connections = [
        addUserConnection("user-h", mine),
        addUserConnection("user-o", other),
      ];

      await eventContext.run({ initiatorId: "user-h:win42" }, () =>
        publishEvent(eventName, {
          userId: "user-h",
          workspaceId: "ws-1",
          ...extra,
        }),
      );
      await vi.waitFor(() => expect((mine as FakeWs).send).toHaveBeenCalled(), {
        timeout: 300,
      });
      expect(lastMessage(mine)).toEqual({
        type,
        workspaceId: "ws-1",
        originWindowId: "win42",
      });
      expect((other as FakeWs).send).not.toHaveBeenCalled();

      removeUserConnection("user-h", connections[0] as never);
      removeUserConnection("user-o", connections[1] as never);
    },
  );

  it("sends a null origin for calls without a window id", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-k", ws);
    await eventContext.run({ initiatorId: "user-k" }, () =>
      publishEvent("sticky.changed", {
        userId: "user-k",
        workspaceId: "ws-2",
        stickyId: null,
        action: "reordered",
      }),
    );
    await vi.waitFor(() => expect((ws as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(lastMessage(ws)).toEqual({
      type: "STICKIES_UPDATED",
      workspaceId: "ws-2",
      originWindowId: null,
    });
    removeUserConnection("user-k", conn);
  });
});
