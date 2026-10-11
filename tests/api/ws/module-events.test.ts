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

const MODULE_EVENTS = [
  "module.created",
  "module.updated",
  "module.deleted",
  "module.archived",
  "module.unarchived",
  "module.reordered",
  "module.links_changed",
  "module.tasks_changed",
];

describe("module events on the project socket", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each(MODULE_EVENTS)(
    "%s reaches other windows of the project as MODULE_UPDATED",
    async (eventName) => {
      const initiator = makeFakeWs();
      const other = makeFakeWs();
      const elsewhere = makeFakeWs();
      const connections = [
        addConnection("proj-m", initiator, "user-1", "window-1"),
        addConnection("proj-m", other, "user-2", "window-2"),
        addConnection("proj-x", elsewhere, "user-3", "window-3"),
      ];

      await eventContext.run({ initiatorId: "window-1" }, () =>
        publishEvent(eventName, {
          projectId: "proj-m",
          userId: "user-1",
          moduleId: "module-1",
        }),
      );

      await vi.waitFor(
        () => expect((other as FakeWs).send).toHaveBeenCalled(),
        { timeout: 300 },
      );
      expect(JSON.parse((other as FakeWs).send.mock.calls[0][0])).toEqual({
        type: "MODULE_UPDATED",
        projectId: "proj-m",
      });
      expect((initiator as FakeWs).send).not.toHaveBeenCalled();
      expect((elsewhere as FakeWs).send).not.toHaveBeenCalled();

      removeConnection("proj-m", connections[0]);
      removeConnection("proj-m", connections[1]);
      removeConnection("proj-x", connections[2]);
    },
  );
});
