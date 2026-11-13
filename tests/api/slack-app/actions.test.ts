import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const {
  captureTask,
  createTaskFromMessage,
  loadTaskPreview,
  messageDescription,
  pickCaptureProject,
  slackTextToMarkdown,
} = await import("../../../apps/api/src/slack-app/actions");
type UserApi = import("../../../apps/api/src/slack-app/acting-user").UserApi;

type Call = { method: string; path: string; body?: unknown };

/** A fake of the API's own routes, answering by method and path. */
function fakeApi(
  routes: Record<string, unknown | ((body: unknown) => unknown)>,
): { api: UserApi; calls: Call[] } {
  const calls: Call[] = [];
  const api: UserApi = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split("?")[0]}`;
    if (!(key in routes)) {
      return { ok: false, status: 404, message: "Not found" };
    }
    const value = routes[key];
    const data = typeof value === "function" ? value(body) : value;
    if (data instanceof Error) {
      return { ok: false, status: 403, message: data.message };
    }
    return { ok: true, status: 200, data: data as never };
  };
  return { api, calls };
}

const projects = [
  { id: "p-web", workspaceId: "ws-1", slug: "web", name: "Website" },
  { id: "p-ops", workspaceId: "ws-1", slug: "ops", name: "Operations" },
];
const columns = [
  { slug: "triage", name: "Triage", group: "triage", isFinal: false },
  { slug: "backlog", name: "Backlog", group: "backlog", isFinal: false },
  { slug: "to-do", name: "To do", group: "unstarted", isFinal: false },
  { slug: "done", name: "Done", group: "completed", isFinal: true },
];

describe("pickCaptureProject", () => {
  it("takes a leading project key, case-insensitive", () => {
    expect(
      pickCaptureProject("OPS restart the queue", projects, "p-web"),
    ).toEqual({ project: projects[1], rest: "restart the queue" });
  });

  it("falls back to the default project, keeping the whole text", () => {
    expect(pickCaptureProject("restart the queue", projects, "p-web")).toEqual({
      project: projects[0],
      rest: "restart the queue",
    });
    expect(pickCaptureProject("ops", projects, null)).toEqual({
      project: null,
      rest: "ops",
    });
  });
});

describe("captureTask", () => {
  it("creates the task as the user with the capture bar's tokens", async () => {
    const { api, calls } = fakeApi({
      "GET /project": projects,
      "GET /workspace/ws-1/members": [{ id: "u-ana", name: "Ana Lima" }],
      "GET /label/workspace/ws-1": [{ name: "Bug", color: "red" }],
      "GET /column/p-ops": columns,
      "POST /task/p-ops": { id: "t-1", number: 7, projectId: "p-ops" },
      "POST /label": { id: "l-1" },
    });
    const result = await captureTask(api, {
      workspaceId: "ws-1",
      defaultProjectId: "p-web",
      text: "OPS Restart the queue @ana #bug !urgent tomorrow",
      today: new Date(2026, 9, 7, 9),
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.message).toContain("OPS-7");
    const create = calls.find((call) => call.path === "/task/p-ops");
    expect(create?.body).toMatchObject({
      title: "Restart the queue",
      status: "to-do",
      assigneeIds: ["u-ana"],
      priority: "urgent",
    });
    expect((create?.body as { dueDate?: string } | undefined)?.dueDate).toBe(
      new Date(2026, 9, 8).toISOString(),
    );
    expect(calls.find((call) => call.path === "/label")?.body).toMatchObject({
      name: "Bug",
      taskId: "t-1",
      workspaceId: "ws-1",
    });
  });

  it("asks for a project when there is no key and no default", async () => {
    const { api, calls } = fakeApi({ "GET /project": projects });
    const result = await captureTask(api, {
      workspaceId: "ws-1",
      defaultProjectId: null,
      text: "Restart the queue",
    });
    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("reports the API's refusal instead of creating anything else", async () => {
    const { api, calls } = fakeApi({
      "GET /project": projects,
      "GET /workspace/ws-1/members": [],
      "GET /label/workspace/ws-1": [],
      "GET /column/p-web": columns,
      "POST /task/p-web": () => new Error("Missing task:create"),
    });
    const result = await captureTask(api, {
      workspaceId: "ws-1",
      defaultProjectId: "p-web",
      text: "Fix it #newlabel",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("isn't allowed");
    expect(calls.some((call) => call.path === "/label")).toBe(false);
  });
});

describe("createTaskFromMessage", () => {
  it("sends the message to intake when asked", async () => {
    const { api, calls } = fakeApi({
      "GET /project/p-web": projects[0],
      "POST /intake/project/p-web": { id: "i-1" },
    });
    const result = await createTaskFromMessage(api, {
      workspaceId: "ws-1",
      projectId: "p-web",
      title: "Login is broken",
      description: "> it broke",
      toIntake: true,
    });
    expect(result).toMatchObject({ ok: true });
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/intake/project/p-web",
      body: { title: "Login is broken", description: "> it broke" },
    });
  });

  it("refuses a project from another workspace", async () => {
    const { api, calls } = fakeApi({
      "GET /project/p-x": { ...projects[0], id: "p-x", workspaceId: "ws-2" },
    });
    const result = await createTaskFromMessage(api, {
      workspaceId: "ws-1",
      projectId: "p-x",
      title: "Anything",
      description: "",
      toIntake: false,
    });
    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});

describe("loadTaskPreview", () => {
  const task = {
    id: "t-1",
    projectId: "p-web",
    number: 12,
    title: "Fix login",
    status: "to-do",
    priority: "high",
    dueDate: "2026-10-09T00:00:00.000Z",
    assignees: [{ name: "Ana Lima" }],
  };

  it("builds a preview from what the user can see", async () => {
    const { api } = fakeApi({
      "GET /task/by-key/ws-1/WEB-12": { id: "t-1" },
      "GET /task/t-1": task,
      "GET /project/p-web": projects[0],
      "GET /column/p-web": columns,
    });
    const preview = await loadTaskPreview(api, "ws-1", { key: "WEB-12" });
    expect(preview).toMatchObject({
      key: "WEB-12",
      title: "Fix login",
      statusName: "To do",
      assigneeNames: ["Ana Lima"],
    });
    // The hidden triage column is never offered as a status.
    expect(preview?.statuses.map((status) => status.slug)).not.toContain(
      "triage",
    );
  });

  it("shows nothing for a task the user can't see", async () => {
    const { api } = fakeApi({});
    expect(await loadTaskPreview(api, "ws-1", { taskId: "t-1" })).toBeNull();
  });

  it("shows nothing for a task of another workspace", async () => {
    const { api } = fakeApi({
      "GET /task/t-1": task,
      "GET /project/p-web": { ...projects[0], workspaceId: "ws-2" },
    });
    expect(await loadTaskPreview(api, "ws-1", { taskId: "t-1" })).toBeNull();
  });
});

describe("Slack text to Markdown", () => {
  it("converts links and mentions and links back to the message", () => {
    expect(
      slackTextToMarkdown(
        "See <https://x.test/a|the doc> and <https://y.test> <@U1|ana> in <#C1|general> &lt;b&gt;",
      ),
    ).toBe(
      "See [the doc](https://x.test/a) and https://y.test @ana in #general <b>",
    );
    expect(
      messageDescription("line one\nline two", "https://t.slack.com/p1"),
    ).toBe(
      "> line one\n> line two\n\nFrom Slack: [view the message](https://t.slack.com/p1)",
    );
  });
});
