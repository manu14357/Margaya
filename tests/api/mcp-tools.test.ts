import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpToolAnnotations } from "../../apps/api/src/mcp/annotations";
import { mcpToolOutputSchema } from "../../apps/api/src/mcp/output";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../apps/api/src/mcp/tools";
import { PROJECT_FEATURE_KEYS } from "../../apps/api/src/project/features";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

function collectTools() {
  const tools = new Map<string, ToolCallback>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, _config, callback) => tools.set(name, callback),
  };
  registerMcpTools(registrar, "http://api.test", "test-token");
  return tools;
}

const tools = collectTools();

function call(name: string, args: unknown = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool(args);
}

let apiFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const [input, init] = apiFetch.mock.calls.at(-1) as [
    RequestInfo | URL,
    RequestInit | undefined,
  ];
  return {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    auth: new Headers(init?.headers).get("authorization"),
  };
}

describe("MCP tool catalog", () => {
  it("resolves workspace members", async () => {
    await call("list_workspace_members", { workspaceId: "ws 1" });

    const request = lastRequest();
    expect(request.url).toBe("http://api.test/api/workspace/ws%201/members");
    expect(request.auth).toBe("Bearer test-token");
  });

  it("posts a comment, or a reply in a thread with parentId", async () => {
    await call("create_task_comment", { taskId: "t 1", content: "Hi" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/comment/t%201",
      method: "POST",
      body: { content: "Hi" },
    });

    await call("create_task_comment", {
      taskId: "t1",
      content: "Agreed",
      parentId: "c1",
    });
    expect(lastRequest().body).toEqual({ content: "Agreed", parentId: "c1" });
  });

  it("passes only the search filters that were supplied", async () => {
    await call("search", { q: "login bug" });
    expect(lastRequest().url).toBe("http://api.test/api/search?q=login+bug");

    await call("search", {
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: 5,
    });
    const url = new URL(lastRequest().url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: "5",
    });
  });

  it("posts task queries to the query engine", async () => {
    await call("query_tasks", {
      workspaceId: "ws1",
      projectIds: ["p1"],
      filters: { key: "assignee", operator: "in", values: ["me"] },
      groupBy: "priority",
      orderBy: "dueDate",
      orderDirection: "asc",
      include: ["labels"],
      limit: 20,
      timeZone: "Asia/Kolkata",
    });

    const request = lastRequest();
    expect(request.url).toBe("http://api.test/api/task-query");
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({
      workspaceId: "ws1",
      scope: { projectIds: ["p1"] },
      filters: { key: "assignee", operator: "in", values: ["me"] },
      display: {
        groupBy: "priority",
        orderBy: { field: "dueDate", direction: "asc" },
      },
      include: ["labels"],
      page: { limit: 20 },
      context: { timeZone: "Asia/Kolkata" },
    });
  });

  it("rejects an unknown task query grouping", async () => {
    const result = await call("query_tasks", {
      workspaceId: "ws1",
      groupBy: "colour",
    });
    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a search limit above the API maximum", async () => {
    const result = await call("search", { q: "x", limit: 500 });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the columns whose slugs are valid task statuses", async () => {
    await call("list_project_columns", { projectId: "p1" });

    expect(lastRequest().url).toBe("http://api.test/api/column/p1");
  });

  it("deletes a task", async () => {
    await call("delete_task", { taskId: "t1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1",
      method: "DELETE",
    });
  });

  it("restores a task from the trash", async () => {
    await call("restore_task", { taskId: "t1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/trash/task/t1/restore",
      method: "POST",
    });
  });

  it("assigns and unassigns a task", async () => {
    await call("update_task_assignee", { taskId: "t1", userId: "u1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/assignee/t1",
      method: "PUT",
      body: { userId: "u1" },
    });

    await call("update_task_assignee", { taskId: "t1", userId: null });
    expect(lastRequest().body).toEqual({ userId: null });
  });

  it("rejects an empty assignee id rather than sending it", async () => {
    const result = await call("update_task_assignee", {
      taskId: "t1",
      userId: "",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sets and clears a due date", async () => {
    await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "2026-09-01T10:00:00Z",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/due-date/t1",
      method: "PUT",
      body: { dueDate: "2026-09-01T10:00:00Z" },
    });

    await call("update_task_due_date", { taskId: "t1" });
    expect(lastRequest().body).toEqual({});
  });

  it("rejects a due date that is not an ISO date-time", async () => {
    const result = await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "next tuesday",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads time entries for a task and by id", async () => {
    await call("list_task_time_entries", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/task/t1");

    await call("get_time_entry", { id: "te1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/te1");
  });

  it("creates a running time entry when endTime is omitted", async () => {
    await call("create_time_entry", {
      taskId: "t1",
      startTime: "2026-08-10T09:00:00Z",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry",
      method: "POST",
      body: { taskId: "t1", startTime: "2026-08-10T09:00:00Z" },
    });
    expect(lastRequest().body).not.toHaveProperty("endTime");
  });

  it("updates a time entry", async () => {
    await call("update_time_entry", {
      id: "te1",
      startTime: "2026-08-10T09:00:00Z",
      endTime: "2026-08-10T10:30:00Z",
      description: "pairing",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry/te1",
      method: "PUT",
      body: {
        startTime: "2026-08-10T09:00:00Z",
        endTime: "2026-08-10T10:30:00Z",
        description: "pairing",
      },
    });
  });

  it("reads task activity and notifications", async () => {
    await call("list_task_activity", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/activity/t1");

    await call("list_notifications");
    expect(lastRequest().url).toBe("http://api.test/api/notification");
  });

  it("sets and patches the assignee list", async () => {
    await call("set_task_assignees", {
      taskId: "t 1",
      assigneeIds: ["u1", "u2"],
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/assignees/t%201",
      method: "PUT",
      body: { assigneeIds: ["u1", "u2"] },
    });

    await call("update_task_assignees", { taskId: "t1", add: ["u3"] });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/assignees/t1",
      method: "PATCH",
      body: { add: ["u3"] },
    });

    await call("update_task_assignees", {
      taskId: "t1",
      add: ["u3"],
      remove: ["u1"],
    });
    expect(lastRequest().body).toEqual({ add: ["u3"], remove: ["u1"] });
  });

  it("rejects more than 20 assignees before calling the API", async () => {
    const result = await call("set_task_assignees", {
      taskId: "t1",
      assigneeIds: Array.from({ length: 21 }, (_, i) => `u${i}`),
    });
    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("creates a task with an assignee list", async () => {
    await call("create_task", {
      projectId: "p1",
      title: "Shared",
      description: "",
      priority: "low",
      status: "to-do",
      assigneeIds: ["u1", "u2"],
      userId: "u9",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/p1",
      method: "POST",
    });
    expect(lastRequest().body).toMatchObject({ assigneeIds: ["u1", "u2"] });
    expect(lastRequest().body).not.toHaveProperty("userId");
  });

  it("creates a subtask by passing the parent with the create", async () => {
    await call("create_task", {
      projectId: "p1",
      title: "Child",
      description: "",
      priority: "low",
      status: "to-do",
      parentId: "t-parent",
    });
    expect(lastRequest().body).toMatchObject({ parentId: "t-parent" });
  });

  it("updates a task, echoing the first assignee unless a list is given", async () => {
    const existing = {
      id: "t1",
      title: "T",
      description: "D",
      status: "to-do",
      priority: "low",
      projectId: "p1",
      position: 3,
      userId: "u1",
      assigneeIds: ["u1", "u2"],
    };
    apiFetch.mockImplementation(async (_input, init?: RequestInit) =>
      Response.json(init?.method === "PUT" ? { ok: true } : existing),
    );

    await call("update_task", { taskId: "t1", status: "done" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1",
      method: "PUT",
      body: { status: "done", userId: "u1" },
    });
    expect(lastRequest().body).not.toHaveProperty("assigneeIds");

    await call("update_task", { taskId: "t1", assigneeIds: ["u2"] });
    expect(lastRequest().body).toMatchObject({ assigneeIds: ["u2"] });
    expect(lastRequest().body).not.toHaveProperty("userId");

    await call("update_task", { taskId: "t1", assigneeIds: null });
    expect(lastRequest().body).toMatchObject({ assigneeIds: [] });
  });

  it("surfaces an API failure as a tool error", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ message: "Task not found" }, { status: 404 }),
    );

    const result = await call("delete_task", { taskId: "missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Task not found");
  });

  it("accepts every relation name, inverse names included", () => {
    const schemas = new Map<string, { parse: (value: unknown) => unknown }>();
    registerMcpTools(
      {
        registerTool: (name, config) =>
          schemas.set(
            name,
            (config as { inputSchema: { parse: (value: unknown) => unknown } })
              .inputSchema,
          ),
      },
      "http://api.test",
      "test-token",
    );
    const schema = schemas.get("create_task_relation");
    const names = [
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
    ];
    for (const relationType of names) {
      expect(() =>
        schema?.parse({ sourceTaskId: "a", targetTaskId: "b", relationType }),
      ).not.toThrow();
    }
    expect(() =>
      schema?.parse({
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "depends_on",
      }),
    ).toThrow();
  });

  it("sets and clears a parent through the parent route", async () => {
    await call("set_task_parent", { taskId: "t 1", parentTaskId: "t2" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task-relation/parent/t%201",
      method: "PUT",
      body: { parentTaskId: "t2" },
    });

    await call("set_task_parent", { taskId: "t1", parentTaskId: null });
    expect(lastRequest().body).toEqual({ parentTaskId: null });
  });
});

describe("project template tools", () => {
  it("lists templates, passing only the filters that were given", async () => {
    await call("list_project_templates");
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/project-template",
      method: "GET",
    });

    await call("list_project_templates", {
      category: "software",
      locale: "de-DE",
    });
    const url = new URL(lastRequest().url);
    expect(url.pathname).toBe("/api/project-template");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: "software",
      locale: "de-DE",
    });
  });

  it("creates a project from a template with the options given", async () => {
    await call("create_project_from_template", {
      workspaceId: "ws1",
      templateId: "kanban",
      name: "Website",
      slug: "WEB",
      icon: "Globe",
      sampleData: true,
      visibility: "restricted",
      features: { cycles: false, intake: true },
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/project",
      method: "POST",
      auth: "Bearer test-token",
    });
    expect(lastRequest().body).toEqual({
      name: "Website",
      workspaceId: "ws1",
      icon: "Globe",
      slug: "WEB",
      visibility: "restricted",
      template: { id: "kanban", sampleData: true },
      features: { cycles: false, intake: true },
    });
  });

  it("uses the template's icon when none is given", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ id: "bug tracker", icon: "Bug" }),
    );

    await call("create_project_from_template", {
      workspaceId: "ws1",
      templateId: "bug tracker",
      name: "Bugs",
      slug: "BUG",
      locale: "fr-FR",
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(String(apiFetch.mock.calls[0]?.[0])).toBe(
      "http://api.test/api/project-template/bug%20tracker",
    );
    expect(lastRequest().body).toEqual({
      name: "Bugs",
      workspaceId: "ws1",
      icon: "Bug",
      slug: "BUG",
      template: { id: "bug tracker", locale: "fr-FR" },
    });
  });

  it("reports an unknown template without creating anything", async () => {
    apiFetch.mockResolvedValueOnce(
      new Response("Template not found", { status: 404 }),
    );

    const result = await call("create_project_from_template", {
      workspaceId: "ws1",
      templateId: "nope",
      name: "X",
      slug: "X",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Template not found");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses bad input before calling the API", async () => {
    for (const args of [
      { workspaceId: "ws1", templateId: "kanban", name: "X" },
      { workspaceId: "ws1", templateId: "x".repeat(65), name: "X", slug: "X" },
      {
        workspaceId: "ws1",
        templateId: "kanban",
        name: "X",
        slug: "X",
        visibility: "secret",
      },
      {
        workspaceId: "ws1",
        templateId: "kanban",
        name: "X",
        slug: "X",
        features: { gantt: true },
      },
    ]) {
      const result = await call("create_project_from_template", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(
      (await call("list_project_templates", { locale: "x".repeat(36) }))
        .isError,
    ).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("accepts every project feature switch the API knows", async () => {
    const features = Object.fromEntries(
      PROJECT_FEATURE_KEYS.map((key) => [key, true]),
    );
    const result = await call("create_project_from_template", {
      workspaceId: "ws1",
      templateId: "kanban",
      name: "X",
      slug: "X",
      icon: "Layout",
      features,
    });
    expect(result.isError).toBe(false);
    expect(lastRequest().body.features).toEqual(features);
  });

  it("keeps the stdio package's feature list in step with the API", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../packages/mcp/src/tools/register.ts", import.meta.url),
      ),
      "utf8",
    );
    const list = source.match(
      /const PROJECT_FEATURE_KEYS = \[([^\]]*)\] as const;/,
    )?.[1];
    expect(list).toBeDefined();
    expect([...(list ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([
      ...PROJECT_FEATURE_KEYS,
    ]);
  });

  it("marks the listing read-only and the create as a plain write", () => {
    expect(mcpToolAnnotations("list_project_templates")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(mcpToolAnnotations("create_project_from_template")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it("declares loose output schemas for both tools", () => {
    expect(
      mcpToolOutputSchema("list_project_templates")?.safeParse({
        revision: "r1",
        locale: "en-US",
        categories: [{ id: "software", name: "Software", icon: "Code" }],
        templates: [
          {
            id: "kanban",
            version: 1,
            categories: ["software"],
            name: "Kanban",
            suggestedKey: "KAN",
            counts: { statuses: 4 },
          },
        ],
      }).success,
    ).toBe(true);
    const created = mcpToolOutputSchema("create_project_from_template");
    const project = { id: "p1", workspaceId: "ws1", slug: "WEB", name: "W" };
    expect(
      created?.safeParse({
        ...project,
        template: { id: "kanban", version: 1, skipped: [] },
      }).success,
    ).toBe(true);
    expect(created?.safeParse(project).success).toBe(false);
  });
});
