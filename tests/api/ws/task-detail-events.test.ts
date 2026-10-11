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

function messagesOf(ws: FakeWs) {
  return ws.send.mock.calls.map((call) => JSON.parse(String(call[0])));
}

/** Sockets: the initiator and a viewer in proj-a, a viewer in proj-b. */
async function publishFrom(
  eventName: string,
  payload: Record<string, unknown>,
) {
  const initiator = makeFakeWs();
  const viewerA = makeFakeWs();
  const viewerB = makeFakeWs();
  const connections = [
    ["proj-a", addConnection("proj-a", initiator, "user-1", "window-1")],
    ["proj-a", addConnection("proj-a", viewerA, "user-2", "window-2")],
    ["proj-b", addConnection("proj-b", viewerB, "user-3", "window-3")],
  ] as const;

  await eventContext.run({ initiatorId: "window-1" }, () =>
    publishEvent(eventName, { userId: "user-1", ...payload }),
  );
  // Broadcasts are batched for 100 ms.
  await new Promise((resolve) => setTimeout(resolve, 250));

  for (const [projectId, connection] of connections) {
    removeConnection(projectId, connection);
  }
  return {
    initiator: initiator as FakeWs,
    viewerA: viewerA as FakeWs,
    viewerB: viewerB as FakeWs,
  };
}

describe("task-detail events on the project socket", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each([
    ["task.link_created", "TASK_LINKS_UPDATED"],
    ["task.link_updated", "TASK_LINKS_UPDATED"],
    ["task.link_deleted", "TASK_LINKS_UPDATED"],
    ["task.attachment_added", "TASK_ATTACHMENTS_UPDATED"],
    ["task.attachment_removed", "TASK_ATTACHMENTS_UPDATED"],
    ["task.start_date_changed", "TASK_UPDATED"],
  ])("%s reaches other windows as %s", async (eventName, type) => {
    const { initiator, viewerA, viewerB } = await publishFrom(eventName, {
      projectId: "proj-a",
      taskId: "task-1",
    });
    expect(messagesOf(viewerA)).toEqual([
      { type, projectId: "proj-a", taskId: "task-1" },
    ]);
    expect(initiator.send).not.toHaveBeenCalled();
    expect(viewerB.send).not.toHaveBeenCalled();
  });

  it("sends a cross-project relation change to both projects", async () => {
    const { viewerA, viewerB } = await publishFrom("task-relation.created", {
      projectId: "proj-a",
      targetProjectId: "proj-b",
      taskId: "task-1",
      sourceTaskId: "task-1",
      targetTaskId: "task-2",
    });
    const message = {
      type: "TASK_RELATION_UPDATED",
      taskId: "task-1",
      sourceTaskId: "task-1",
      targetTaskId: "task-2",
    };
    expect(messagesOf(viewerA)).toEqual([{ ...message, projectId: "proj-a" }]);
    expect(messagesOf(viewerB)).toEqual([{ ...message, projectId: "proj-b" }]);
  });

  it("sends a same-project relation change once", async () => {
    const { viewerA, viewerB } = await publishFrom("task-relation.deleted", {
      projectId: "proj-a",
      targetProjectId: "proj-a",
      taskId: "task-1",
      sourceTaskId: "task-1",
      targetTaskId: "task-2",
    });
    expect(messagesOf(viewerA)).toHaveLength(1);
    expect(viewerB.send).not.toHaveBeenCalled();
  });

  it("refreshes the child's project, and a legacy old parent's project", async () => {
    const { viewerA, viewerB } = await publishFrom("task.parent_changed", {
      projectId: "proj-a",
      taskId: "child",
      oldParent: { id: "old", projectId: "proj-b" },
      newParent: { id: "new", projectId: "proj-a" },
    });
    expect(messagesOf(viewerA)).toEqual([
      {
        type: "TASK_RELATION_UPDATED",
        projectId: "proj-a",
        taskId: "child",
        sourceTaskId: "new",
        targetTaskId: "child",
      },
    ]);
    expect(messagesOf(viewerB)).toEqual([
      {
        type: "TASK_RELATION_UPDATED",
        projectId: "proj-b",
        taskId: "child",
        sourceTaskId: "old",
        targetTaskId: "child",
      },
    ]);
  });
});
