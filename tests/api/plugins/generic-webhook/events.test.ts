import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postToGenericWebhook } from "../../../../apps/api/src/plugins/generic-webhook/client";
import {
  handleTaskAssigneeChanged,
  handleTaskDeleted,
  handleTaskUnassigned,
} from "../../../../apps/api/src/plugins/generic-webhook/events";

const { selectMock, findFirstMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock("../../../../apps/api/src/plugins/generic-webhook/client", () => ({
  postToGenericWebhook: vi.fn(),
}));

vi.mock("../../../../apps/api/src/database", () => ({
  default: {
    select: selectMock,
    query: {
      integrationTable: {
        findFirst: findFirstMock,
      },
    },
  },
}));

function selectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

/** Any query builder chain that resolves to `rows` when awaited. */
function anyChain(rows: unknown[]): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(rows).then(resolve, reject);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

/** getTaskData's task row, its assignee rows, then the actor. */
function mockTaskEnvelope(assigneeIds: string[]) {
  selectMock
    .mockImplementationOnce(() =>
      anyChain([
        {
          id: "task-1",
          title: "Ship the release",
          number: 7,
          status: "to-do",
          priority: "high",
          columnName: "To Do",
          projectId: "project-1",
          projectName: "Roadmap",
          workspaceId: "workspace-1",
        },
      ]),
    )
    .mockImplementationOnce(() =>
      anyChain(assigneeIds.map((userId) => ({ taskId: "task-1", userId }))),
    )
    .mockImplementationOnce(() => anyChain([{ id: "user-1", name: "Jordan" }]));
}

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    webhookUrl: "https://example.com/hooks/margaya",
  },
};

const enabledContext = {
  ...context,
  config: {
    webhookUrl: "https://example.com/hooks/margaya",
    events: { taskDeleted: true },
  },
};

const deletedEvent = {
  taskId: "task-1",
  projectId: "project-1",
  userId: "user-1",
  title: "Ship the release",
};

describe("generic webhook event handlers", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.mocked(postToGenericWebhook).mockClear();
    selectMock.mockReset();
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(undefined);
  });

  it("does not post task.unassigned when taskUnassigned is disabled", async () => {
    await handleTaskUnassigned(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        title: "Ship the release",
      },
      context,
    );

    expect(postToGenericWebhook).not.toHaveBeenCalled();
  });

  it("does not post task.deleted when taskDeleted is disabled", async () => {
    await handleTaskDeleted(deletedEvent, context);

    expect(postToGenericWebhook).not.toHaveBeenCalled();
  });

  it("posts a project-scoped task.deleted envelope when enabled", async () => {
    selectMock
      .mockImplementationOnce(() =>
        selectChain([
          { id: "project-1", name: "Roadmap", workspaceId: "workspace-1" },
        ]),
      )
      .mockImplementationOnce(() =>
        selectChain([{ id: "user-1", name: "Jordan" }]),
      );

    await handleTaskDeleted(deletedEvent, enabledContext);

    expect(postToGenericWebhook).toHaveBeenCalledTimes(1);
    const [url, payload] = vi.mocked(postToGenericWebhook).mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/hooks/margaya");
    expect(payload).toMatchObject({
      event: "task.deleted",
      integration: { type: "generic-webhook" },
      project: { id: "project-1", name: "Roadmap", workspaceId: "workspace-1" },
      task: { id: "task-1", title: "Ship the release" },
      actor: { id: "user-1", name: "Jordan" },
      data: {},
    });
  });

  it("does not log a credential-bearing URL or unknown transport error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secretUrl =
      "https://example.com/hooks/private-token?key=secret-value";
    selectMock
      .mockImplementationOnce(() =>
        selectChain([
          { id: "project-1", name: "Roadmap", workspaceId: "workspace-1" },
        ]),
      )
      .mockImplementationOnce(() =>
        selectChain([{ id: "user-1", name: "User" }]),
      );
    vi.mocked(postToGenericWebhook).mockRejectedValueOnce(new Error(secretUrl));
    await handleTaskDeleted(deletedEvent, {
      ...enabledContext,
      config: { ...enabledContext.config, webhookUrl: secretUrl },
    });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
    expect(JSON.stringify(log.mock.calls)).toContain("Outbound request failed");
  });

  it("posts every assignee with a task.assignee_changed event", async () => {
    mockTaskEnvelope(["user-2", "user-3"]);

    await handleTaskAssigneeChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        title: "Ship the release",
        oldAssignee: "user-2",
        newAssignee: "Robin",
        newAssigneeId: "user-3",
        assigneeIds: ["user-2", "user-3"],
      },
      {
        ...context,
        config: { ...context.config, events: { taskAssigneeChanged: true } },
      },
    );

    const [, payload] = vi.mocked(postToGenericWebhook).mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      event: "task.assignee_changed",
      task: { id: "task-1", assigneeIds: ["user-2", "user-3"] },
      data: {
        oldAssigneeId: "user-2",
        newAssigneeId: "user-3",
        newAssignee: "Robin",
        assigneeIds: ["user-2", "user-3"],
      },
    });
  });

  it("names the removed user in a task.unassigned event", async () => {
    mockTaskEnvelope(["user-3"]);

    await handleTaskUnassigned(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        title: "Ship the release",
        oldAssigneeId: "user-2",
        oldAssignee: "Sam",
        assigneeIds: ["user-3"],
      },
      {
        ...context,
        config: { ...context.config, events: { taskUnassigned: true } },
      },
    );

    const [, payload] = vi.mocked(postToGenericWebhook).mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      event: "task.unassigned",
      task: { assigneeIds: ["user-3"] },
      data: {
        title: "Ship the release",
        oldAssigneeId: "user-2",
        oldAssignee: "Sam",
        assigneeIds: ["user-3"],
      },
    });
  });

  it("skips task.deleted when the project row no longer exists", async () => {
    selectMock.mockImplementationOnce(() => selectChain([]));

    await handleTaskDeleted(deletedEvent, enabledContext);

    expect(postToGenericWebhook).not.toHaveBeenCalled();
  });
});
