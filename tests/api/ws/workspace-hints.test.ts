import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Audiences come from the database; the test pins them.
const audience = vi.hoisted(() => ({
  members: new Map<string, string[]>(),
  coMembers: new Map<string, string[]>(),
  holders: [] as { userId: string; workspaceId: string }[],
  holderCalls: [] as [string, readonly string[]][],
}));

vi.mock("../../../apps/api/src/ws/audience", () => ({
  workspaceMemberIds: async (workspaceId: string) =>
    audience.members.get(workspaceId) ?? [],
  coMemberIds: async (userId: string) =>
    audience.coMembers.get(userId) ?? [userId],
  entityReferenceHolders: async (type: string, ids: readonly string[]) => {
    audience.holderCalls.push([type, ids]);
    return audience.holders;
  },
}));

import { eventContext, publishEvent } from "../../../apps/api/src/events";
import {
  addConnection,
  addUserConnection,
  initializeWebSocketAdapter,
  removeConnection,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";
import "../../../apps/api/src/ws/workspace-hints";

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

function messages(ws: unknown) {
  return (ws as FakeWs).send.mock.calls.map((call) => JSON.parse(call[0]));
}

const sockets = new Map<string, unknown>();
const userConnections: [string, ReturnType<typeof addUserConnection>][] = [];

function connectUsers(...userIds: string[]) {
  for (const userId of userIds) {
    const ws = makeFakeWs();
    sockets.set(userId, ws);
    userConnections.push([userId, addUserConnection(userId, ws)]);
  }
}

const received = (userId: string) => messages(sockets.get(userId));

async function publishAs(initiatorId: string, name: string, data: object) {
  await eventContext.run({ initiatorId }, () =>
    publishEvent(name, data, { waitForHandlers: true }),
  );
}

beforeEach(async () => {
  delete process.env.REDIS_URL;
  await initializeWebSocketAdapter();
  audience.members.set("ws-1", ["alice", "bob"]);
  audience.coMembers.set("alice", ["alice", "bob"]);
  audience.holders = [];
  audience.holderCalls = [];
});

afterEach(async () => {
  for (const [userId, conn] of userConnections.splice(0)) {
    removeUserConnection(userId, conn);
  }
  sockets.clear();
  await shutdownWebSocketAdapter();
});

describe("profile hints", () => {
  it("reach the person and their co-members, never anyone else", async () => {
    connectUsers("alice", "bob", "outsider");
    await publishAs("alice:win-1", "user.profile_changed", {
      userId: "alice",
    });
    const hint = { type: "USER_PROFILE_UPDATED", userId: "alice" };
    // The person's own tabs and devices too: the user channel keeps the
    // initiator, so the desktop app and other tabs reload the session.
    expect(received("alice")).toEqual([hint]);
    expect(received("bob")).toEqual([hint]);
    expect(received("outsider")).toEqual([]);
  });
});

describe("workspace-wide hints", () => {
  it.each([
    ["workspace.updated", "WORKSPACE_UPDATED"],
    ["workspace.settings_updated", "WORKSPACE_UPDATED"],
    ["label.changed", "LABELS_UPDATED"],
    ["project.created", "PROJECTS_UPDATED"],
    ["project.updated", "PROJECTS_UPDATED"],
    ["project.features_updated", "PROJECTS_UPDATED"],
    ["project.archived", "PROJECTS_UPDATED"],
    ["project.unarchived", "PROJECTS_UPDATED"],
    ["project.deleted", "PROJECTS_UPDATED"],
    ["project.restored", "PROJECTS_UPDATED"],
    ["project.purged", "PROJECTS_UPDATED"],
    ["project.reordered", "PROJECTS_UPDATED"],
  ])("%s sends %s to every member with ids only", async (eventName, type) => {
    connectUsers("alice", "bob", "outsider");
    await publishAs("alice:win-1", eventName, {
      workspaceId: "ws-1",
      projectId: "secret-project",
      userId: "alice",
      name: "Restricted project name",
    });
    // No project id or name: a restricted project is not revealed.
    expect(received("alice")).toEqual([{ type, workspaceId: "ws-1" }]);
    expect(received("bob")).toEqual([{ type, workspaceId: "ws-1" }]);
    expect(received("outsider")).toEqual([]);
  });

  it("ignores events without a workspace", async () => {
    connectUsers("alice");
    await publishAs("alice:win-1", "label.changed", {});
    expect(received("alice")).toEqual([]);
  });
});

describe("workspace view hints", () => {
  const view = {
    viewId: "view-1",
    workspaceId: "ws-1",
    projectId: null,
    userId: "alice",
  };

  it("send a shared view's change to every member", async () => {
    connectUsers("alice", "bob");
    await publishAs("alice:w", "view.updated", {
      ...view,
      access: "workspace",
    });
    const hint = { type: "VIEWS_UPDATED", workspaceId: "ws-1" };
    expect(received("alice")).toContainEqual(hint);
    expect(received("bob")).toContainEqual(hint);
  });

  it("keep a private view's change to its owner", async () => {
    connectUsers("alice", "bob");
    await publishAs("alice:w", "view.created", { ...view, access: "private" });
    expect(received("alice")).toEqual([
      { type: "VIEWS_UPDATED", workspaceId: "ws-1" },
    ]);
    expect(received("bob")).toEqual([]);
  });

  it("tell everyone when a view becomes private", async () => {
    connectUsers("alice", "bob");
    await publishAs("alice:w", "view.updated", {
      ...view,
      access: "private",
      changes: ["access"],
    });
    expect(received("bob")).toContainEqual({
      type: "VIEWS_UPDATED",
      workspaceId: "ws-1",
    });
  });

  it("leave project views to the project socket", async () => {
    connectUsers("alice", "bob");
    await publishAs("alice:w", "view.deleted", {
      ...view,
      projectId: "p1",
      access: "workspace",
    });
    expect(received("bob")).toEqual([]);
  });
});

describe("favorite and recent visit hints", () => {
  it("go to the people holding the renamed entity, per workspace", async () => {
    connectUsers("alice", "bob", "carol");
    audience.holders = [
      { userId: "bob", workspaceId: "ws-1" },
      { userId: "carol", workspaceId: "ws-1" },
    ];
    await publishAs("alice:w", "cycle.updated", {
      cycleId: "cycle-1",
      projectId: "p1",
      userId: "alice",
    });
    expect(audience.holderCalls).toEqual([["cycle", ["cycle-1"]]]);
    const hint = { type: "REFERENCES_UPDATED", workspaceId: "ws-1" };
    expect(received("bob")).toEqual([hint]);
    expect(received("carol")).toEqual([hint]);
    expect(received("alice")).toEqual([]);
  });

  it("include sub-pages a page change carried along", async () => {
    await publishAs("alice:w", "page.archived", {
      pageId: "page-1",
      projectId: "p1",
      workspaceId: "ws-1",
      affectedPageIds: ["page-1", "page-2"],
    });
    expect(audience.holderCalls).toEqual([
      ["page", ["page-1", "page-1", "page-2"]],
    ]);
  });

  it("reach the owners of removed rows once each", async () => {
    connectUsers("bob");
    await publishAs("alice:w", "entity_reference.removed", {
      entityType: "module",
      holders: [
        { userId: "bob", workspaceId: "ws-1" },
        { userId: "bob", workspaceId: "ws-1" },
      ],
    });
    expect(received("bob")).toEqual([
      { type: "REFERENCES_UPDATED", workspaceId: "ws-1" },
    ]);
  });
});

describe("inbox count hints", () => {
  it("refresh the counts of a member who lost a project", async () => {
    connectUsers("alice", "bob");
    await publishAs("alice:w", "project.access_changed", {
      projectId: "p1",
      workspaceId: "ws-1",
      action: "member_removed",
      memberUserId: "bob",
    });
    expect(received("bob")).toContainEqual({
      type: "NOTIFICATIONS_UPDATED",
      workspaceId: "ws-1",
    });
    expect(received("alice")).not.toContainEqual({
      type: "NOTIFICATIONS_UPDATED",
      workspaceId: "ws-1",
    });
  });

  it("refresh the counts of someone removed from the workspace", async () => {
    connectUsers("carol");
    await publishAs("alice:w", "workspace.members_changed", {
      workspaceId: "ws-1",
      userId: "carol",
      accessEnded: true,
    });
    expect(received("carol")).toContainEqual({
      type: "NOTIFICATIONS_UPDATED",
      workspaceId: "ws-1",
    });
  });
});

describe("custom field project hints", () => {
  it("send a value change as TASK_UPDATED, then the project's values hint", async () => {
    const initiator = makeFakeWs();
    const other = makeFakeWs();
    const connections = [
      addConnection("proj-cf", initiator, "user-1", "user-1:w1"),
      addConnection("proj-cf", other, "user-2", "user-2:w2"),
    ];
    await publishAs("user-1:w1", "task.custom_field_changed", {
      projectId: "proj-cf",
      taskId: "t1",
      fieldId: "f1",
      userId: "user-1",
    });
    await vi.waitFor(() => expect(messages(other)).toHaveLength(2), {
      timeout: 500,
    });
    expect(messages(other)).toEqual([
      { type: "TASK_UPDATED", projectId: "proj-cf", taskId: "t1" },
      { type: "CUSTOM_FIELD_VALUES_UPDATED", projectId: "proj-cf" },
    ]);
    expect(messages(initiator)).toEqual([]);
    for (const conn of connections) removeConnection("proj-cf", conn);
  });

  it("send a reorder as CUSTOM_FIELDS_UPDATED", async () => {
    const other = makeFakeWs();
    const conn = addConnection("proj-cf", other, "user-2", "user-2:w2");
    await publishAs("user-1:w1", "custom_field.reordered", {
      projectId: "proj-cf",
    });
    await vi.waitFor(() => expect(messages(other)).toHaveLength(1), {
      timeout: 500,
    });
    expect(messages(other)).toEqual([
      { type: "CUSTOM_FIELDS_UPDATED", projectId: "proj-cf", taskId: "" },
    ]);
    removeConnection("proj-cf", conn);
  });
});
