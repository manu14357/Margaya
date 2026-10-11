import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventContext, publishEvent } from "../../../apps/api/src/events";
import {
  addConnection,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";

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

const VIEW_EVENTS = ["view.created", "view.updated", "view.deleted"];

describe("saved view events on the project socket", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each(VIEW_EVENTS)(
    "%s of a project view reaches other windows as a data-less VIEWS_UPDATED",
    async (eventName) => {
      const initiator = makeFakeWs();
      const other = makeFakeWs();
      const elsewhere = makeFakeWs();
      const connections = [
        addConnection("proj-v", initiator, "user-1", "window-1"),
        addConnection("proj-v", other, "user-2", "window-2"),
        addConnection("proj-x", elsewhere, "user-3", "window-3"),
      ];

      await eventContext.run({ initiatorId: "window-1" }, () =>
        publishEvent(eventName, {
          viewId: "view-1",
          workspaceId: "workspace-1",
          projectId: "proj-v",
          userId: "user-1",
          access: "private",
        }),
      );

      await vi.waitFor(
        () => expect((other as FakeWs).send).toHaveBeenCalled(),
        { timeout: 300 },
      );
      expect(JSON.parse((other as FakeWs).send.mock.calls[0][0])).toEqual({
        type: "VIEWS_UPDATED",
        projectId: "proj-v",
        taskId: "",
      });
      expect((initiator as FakeWs).send).not.toHaveBeenCalled();
      expect((elsewhere as FakeWs).send).not.toHaveBeenCalled();

      removeConnection("proj-v", connections[0]);
      removeConnection("proj-v", connections[1]);
      removeConnection("proj-x", connections[2]);
    },
  );

  it("sends nothing for workspace views", async () => {
    const watcher = makeFakeWs();
    const connection = addConnection("proj-v", watcher, "user-2", "window-2");

    await publishEvent("view.updated", {
      viewId: "view-2",
      workspaceId: "workspace-1",
      projectId: null,
      userId: "user-1",
      access: "workspace",
      changes: ["name"],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((watcher as FakeWs).send).not.toHaveBeenCalled();

    removeConnection("proj-v", connection);
  });
});
