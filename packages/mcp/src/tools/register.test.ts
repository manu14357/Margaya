import { describe, expect, it, vi } from "vitest";
import { registerTools } from "./register.js";

type RegisteredTool = {
  name: string;
  config: { inputSchema?: { parse: (args: unknown) => unknown } };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
};

function createServerMock() {
  const tools = new Map<string, RegisteredTool>();

  return {
    server: {
      registerTool: vi.fn(
        (
          name: string,
          config: RegisteredTool["config"],
          handler: RegisteredTool["handler"],
        ) => {
          tools.set(name, { name, config, handler });
        },
      ),
    },
    tools,
  };
}

describe("registerTools", () => {
  it("registers the MCP tools", () => {
    const { server } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    expect(server.registerTool).toHaveBeenCalled();
    expect(server.registerTool).toHaveBeenCalledWith(
      "whoami",
      expect.any(Object),
      expect.any(Function),
    );
    expect(server.registerTool).toHaveBeenCalledWith(
      "update_task",
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("posts query_tasks to the task query engine", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue({ totalCount: 0 }) };

    registerTools(server as never, { client: client as never });

    await tools.get("query_tasks")?.handler({
      workspaceId: "ws1",
      mode: "ids",
      filters: { key: "priority", operator: "in", values: ["high"] },
      archived: "include",
    });

    expect(client.json).toHaveBeenCalledWith("/api/task-query", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "ws1",
        filters: { key: "priority", operator: "in", values: ["high"] },
        archived: "include",
        display: {},
        mode: "ids",
        page: {},
      }),
    });
  });

  it("builds the expected query string for list_tasks", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue([{ id: "task-1" }]),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("list_tasks")?.handler({
      projectId: "project 1",
      status: "open",
      page: 2,
      relatedPage: 3,
      sortOrder: "desc",
    });

    expect(client.json).toHaveBeenCalledWith(
      "/api/task/tasks/project%201?status=open&page=2&relatedPage=3&sortOrder=desc",
      { method: "GET" },
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ id: "task-1" }], null, 2),
        },
      ],
      isError: false,
    });
  });

  it("fetches the current task and sends a full body for update_task", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({
          title: "Draft spec",
          description: "Write docs",
          status: "open",
          priority: "medium",
          projectId: "project-1",
          position: 4,
        })
        .mockResolvedValueOnce({ id: "task-1", status: "done" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("update_task")?.handler({
      taskId: "task-1",
      status: "done",
    });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/task/task-1", {
      method: "GET",
    });
    const putCall = client.json.mock.calls[1];
    expect(putCall?.[0]).toBe("/api/task/task-1");
    const putBody = JSON.parse(
      String((putCall?.[1] as { body?: string })?.body ?? "{}"),
    );
    expect(putBody).toEqual(
      expect.objectContaining({
        title: "Draft spec",
        description: "Write docs",
        status: "done",
        priority: "medium",
        projectId: "project-1",
        position: 4,
      }),
    );
    expect(result?.isError).toBe(false);
  });

  it("fetches the current project and sends a full body for update_project", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({
          name: "Roadmap",
          slug: "roadmap",
        })
        .mockResolvedValueOnce({ id: "project-1", name: "Roadmap v2" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("update_project")?.handler({
      id: "project-1",
      name: "Roadmap v2",
    });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/project/project-1", {
      method: "GET",
    });
    const putCall = client.json.mock.calls[1];
    expect(putCall?.[0]).toBe("/api/project/project-1");
    const putBody = JSON.parse(
      String((putCall?.[1] as { body?: string })?.body ?? "{}"),
    );
    expect(putBody).toEqual({
      name: "Roadmap v2",
      icon: "Layout",
      slug: "roadmap",
      description: "",
      isPublic: false,
    });
    expect(result?.isError).toBe(false);
  });

  it("returns an MCP error result when the client request fails", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockRejectedValue(new Error("boom")),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("whoami")?.handler({});

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "boom" }, null, 2),
        },
      ],
      isError: true,
    });
  });

  it("validates label colors as hex values", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("create_label")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        name: "Bug",
        color: "red",
        workspaceId: "workspace-1",
      }),
    ).toThrow(/hex color/i);
  });

  it("validates task date filters as ISO datetimes with timezone", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("list_tasks")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        projectId: "project-1",
        dueBefore: "2026-04-04",
      }),
    ).toThrow();
  });

  it("creates a task relation with the expected body", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue({ id: "rel-1", relationType: "blocks" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("create_task_relation")?.handler({
      sourceTaskId: "task-1",
      targetTaskId: "task-2",
      relationType: "blocks",
    });

    expect(client.json).toHaveBeenCalledWith("/api/task-relation", {
      method: "POST",
      body: JSON.stringify({
        sourceTaskId: "task-1",
        targetTaskId: "task-2",
        relationType: "blocks",
      }),
    });
    expect(result?.isError).toBe(false);
  });

  it("validates relationType for create_task_relation", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("create_task_relation")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        sourceTaskId: "task-1",
        targetTaskId: "task-2",
        relationType: "depends_on",
      }),
    ).toThrow();
    for (const relationType of [
      "subtask",
      "blocks",
      "blocking",
      "blocked_by",
      "related",
      "duplicate",
      "start_before",
      "start_after",
      "finish_before",
      "finish_after",
    ]) {
      expect(() =>
        schema?.parse({
          sourceTaskId: "task-1",
          targetTaskId: "task-2",
          relationType,
        }),
      ).not.toThrow();
    }
  });

  it("sets and clears a task's parent", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue({ parent: null }) };

    registerTools(server as never, { client: client as never });

    await tools.get("set_task_parent")?.handler({
      taskId: "task 1",
      parentTaskId: "task-2",
    });
    expect(client.json).toHaveBeenLastCalledWith(
      "/api/task-relation/parent/task%201",
      { method: "PUT", body: JSON.stringify({ parentTaskId: "task-2" }) },
    );

    await tools.get("set_task_parent")?.handler({
      taskId: "task-1",
      parentTaskId: null,
    });
    expect(client.json).toHaveBeenLastCalledWith(
      "/api/task-relation/parent/task-1",
      { method: "PUT", body: JSON.stringify({ parentTaskId: null }) },
    );
  });

  it("gets task relations by task id", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue([]) };

    registerTools(server as never, { client: client as never });

    await tools.get("get_task_relations")?.handler({ taskId: "task 1" });

    expect(client.json).toHaveBeenCalledWith("/api/task-relation/task%201", {
      method: "GET",
    });
  });

  it("deletes a task relation by id", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue({}) };

    registerTools(server as never, { client: client as never });

    await tools.get("delete_task_relation")?.handler({ id: "rel-1" });

    expect(client.json).toHaveBeenCalledWith("/api/task-relation/rel-1", {
      method: "DELETE",
    });
  });

  it("deletes a task-associated label after a preflight check", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({ id: "label-1", taskId: "task-1" })
        .mockResolvedValueOnce({ id: "label-1" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("delete_label")?.handler({ id: "label-1" });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/label/label-1", {
      method: "GET",
    });
    expect(client.json).toHaveBeenNthCalledWith(2, "/api/label/label-1", {
      method: "DELETE",
    });
    expect(result?.isError).toBe(false);
  });

  it("refuses to delete a workspace label (taskId null)", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue({ id: "label-1", taskId: null }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("delete_label")?.handler({ id: "label-1" });

    expect(result?.isError).toBe(true);
    expect(client.json).toHaveBeenCalledTimes(1);
    expect(client.json).toHaveBeenCalledWith("/api/label/label-1", {
      method: "GET",
    });
  });
  it("sets and patches task assignees", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue({ id: "task-1" }) };
    registerTools(server as never, { client: client as never });

    await tools.get("set_task_assignees")?.handler({
      taskId: "task 1",
      assigneeIds: ["user-1", "user-2"],
    });
    expect(client.json).toHaveBeenLastCalledWith(
      "/api/task/assignees/task%201",
      {
        method: "PUT",
        body: JSON.stringify({ assigneeIds: ["user-1", "user-2"] }),
      },
    );

    await tools.get("update_task_assignees")?.handler({
      taskId: "task-1",
      add: ["user-3"],
      remove: ["user-1"],
    });
    expect(client.json).toHaveBeenLastCalledWith("/api/task/assignees/task-1", {
      method: "PATCH",
      body: JSON.stringify({ add: ["user-3"], remove: ["user-1"] }),
    });
  });

  it("caps assignee lists at 20", () => {
    const { server, tools } = createServerMock();
    registerTools(server as never, { client: { json: vi.fn() } as never });

    const schema = tools.get("set_task_assignees")?.config.inputSchema;
    const ids = Array.from({ length: 21 }, (_, i) => `user-${i}`);
    expect(() =>
      schema?.parse({ taskId: "task-1", assigneeIds: ids }),
    ).toThrow();
    expect(() =>
      schema?.parse({ taskId: "task-1", assigneeIds: ids.slice(0, 20) }),
    ).not.toThrow();
  });

  it("creates a task with assigneeIds instead of the single userId", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue({ id: "task-1" }) };
    registerTools(server as never, { client: client as never });

    await tools.get("create_task")?.handler({
      projectId: "project-1",
      title: "Shared",
      description: "",
      priority: "low",
      status: "open",
      assigneeIds: ["user-1", "user-2"],
      userId: "user-9",
    });

    const body = JSON.parse(
      String((client.json.mock.calls[0]?.[1] as { body?: string })?.body),
    );
    expect(body.assigneeIds).toEqual(["user-1", "user-2"]);
    expect(body).not.toHaveProperty("userId");
  });

  it("keeps every assignee on update_task unless assigneeIds is given", async () => {
    const existing = {
      title: "Draft spec",
      description: "",
      status: "open",
      priority: "medium",
      projectId: "project-1",
      position: 4,
      userId: "user-1",
      assigneeIds: ["user-1", "user-2"],
    };
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn(async (_path: string, init?: { method?: string }) =>
        init?.method === "GET" ? existing : { id: "task-1" },
      ),
    };
    registerTools(server as never, { client: client as never });

    const putBody = () =>
      JSON.parse(
        String((client.json.mock.calls.at(-1)?.[1] as { body?: string })?.body),
      );

    await tools.get("update_task")?.handler({ taskId: "task-1", title: "X" });
    expect(putBody()).toMatchObject({ userId: "user-1" });
    expect(putBody()).not.toHaveProperty("assigneeIds");

    await tools
      .get("update_task")
      ?.handler({ taskId: "task-1", assigneeIds: ["user-2"] });
    expect(putBody()).toMatchObject({ assigneeIds: ["user-2"] });
    expect(putBody()).not.toHaveProperty("userId");

    await tools
      .get("update_task")
      ?.handler({ taskId: "task-1", assigneeIds: null });
    expect(putBody()).toMatchObject({ assigneeIds: [] });
  });
});
