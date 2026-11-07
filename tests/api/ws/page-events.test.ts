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

function sent(ws: unknown) {
  return (ws as FakeWs).send.mock.calls.map((call) => JSON.parse(call[0]));
}

const payload = {
  pageId: "page-1",
  projectId: "proj-p",
  workspaceId: "workspace-1",
  userId: "user-1",
};

describe("page events on the project socket", () => {
  let connections: Array<[string, ReturnType<typeof addConnection>]> = [];

  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
    connections = [];
  });

  afterEach(async () => {
    for (const [projectId, connection] of connections) {
      removeConnection(projectId, connection);
    }
    await shutdownWebSocketAdapter();
  });

  function watch(projectId: string, windowId: string) {
    const ws = makeFakeWs();
    connections.push([
      projectId,
      addConnection(projectId, ws, "user-2", windowId),
    ]);
    return ws;
  }

  it.each([
    "page.created",
    "page.updated",
    "page.locked",
    "page.unlocked",
    "page.version_restored",
    "page.comment_created",
    "page.comment_updated",
    "page.comment_deleted",
  ])(
    "%s reaches other windows as PAGE_UPDATED with ids only",
    async (eventName) => {
      const initiator = watch("proj-p", "window-1");
      const other = watch("proj-p", "window-2");
      await eventContext.run({ initiatorId: "window-1" }, () =>
        publishEvent(eventName, { ...payload, title: "Secret title" }),
      );
      await vi.waitFor(
        () => expect((other as FakeWs).send).toHaveBeenCalled(),
        {
          timeout: 300,
        },
      );
      expect(sent(other)).toEqual([
        { type: "PAGE_UPDATED", projectId: "proj-p", pageId: "page-1" },
      ]);
      expect((initiator as FakeWs).send).not.toHaveBeenCalled();
    },
  );

  it.each([
    "page.reordered",
    "page.archived",
    "page.unarchived",
    "page.access_changed",
    "page.restored",
    "page.purged",
  ])("%s sends PAGES_UPDATED", async (eventName) => {
    const other = watch("proj-p", "window-2");
    await publishEvent(eventName, { ...payload, affectedPageIds: ["page-1"] });
    await vi.waitFor(() => expect((other as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(sent(other)).toEqual([
      { type: "PAGES_UPDATED", projectId: "proj-p" },
    ]);
  });

  it("page.moved refreshes both projects", async () => {
    const from = watch("proj-a", "window-2");
    const to = watch("proj-b", "window-3");
    await publishEvent("page.moved", {
      ...payload,
      projectId: "proj-b",
      fromProjectId: "proj-a",
      toProjectId: "proj-b",
      pageIds: ["page-1"],
    });
    await vi.waitFor(
      () => {
        expect(sent(from)).toEqual([
          { type: "PAGES_UPDATED", projectId: "proj-a" },
        ]);
        expect(sent(to)).toEqual([
          { type: "PAGES_UPDATED", projectId: "proj-b" },
        ]);
      },
      { timeout: 300 },
    );
  });

  it("page.deleted sends PAGE_DELETED", async () => {
    const other = watch("proj-p", "window-2");
    await publishEvent("page.deleted", payload);
    await vi.waitFor(
      () =>
        expect(sent(other)).toEqual([
          { type: "PAGE_DELETED", projectId: "proj-p", pageId: "page-1" },
        ]),
      { timeout: 300 },
    );
  });

  it("throttles content saves to one leading hint per page per minute", async () => {
    const other = watch("proj-p", "window-2");
    await publishEvent("page.content_updated", {
      ...payload,
      contentVersion: 2,
    });
    await publishEvent("page.content_updated", {
      ...payload,
      contentVersion: 3,
    });
    await publishEvent("page.content_updated", {
      ...payload,
      pageId: "page-2",
      contentVersion: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent(other)).toEqual([
      { type: "PAGE_UPDATED", projectId: "proj-p", pageId: "page-1" },
      { type: "PAGE_UPDATED", projectId: "proj-p", pageId: "page-2" },
    ]);
  });
});
