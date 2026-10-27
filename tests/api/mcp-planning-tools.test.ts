import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANNING_TOOL_NAMES } from "../../apps/api/src/mcp/planning-tools";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../apps/api/src/mcp/tools";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

const tools = new Map<string, ToolCallback>();
const registrar: McpToolRegistrar = {
  registerTool: (name, _config, callback) => tools.set(name, callback),
};
registerMcpTools(registrar, "http://api.test", "test-token");

function call(name: string, args: unknown) {
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

function requests() {
  return apiFetch.mock.calls.map(([input, init]) => ({
    url: String(input),
    method: (init as RequestInit | undefined)?.method ?? "GET",
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }));
}

describe("MCP planning tools (cycles, modules, intake)", () => {
  it("registers all 33 tools, identical to the stdio package's file", () => {
    for (const name of PLANNING_TOOL_NAMES) expect(tools.has(name)).toBe(true);
    expect(PLANNING_TOOL_NAMES).toHaveLength(40);

    const root = resolve(__dirname, "../..");
    expect(
      readFileSync(resolve(root, "apps/api/src/mcp/planning-tools.ts"), "utf8"),
    ).toBe(
      readFileSync(
        resolve(root, "packages/mcp/src/tools/planning-tools.ts"),
        "utf8",
      ),
    );
  });

  it("creates a cycle, and refuses a single date before calling the API", async () => {
    const refused = await call("create_cycle", {
      projectId: "p 1",
      name: "Sprint",
      startDate: "2026-10-01",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain(
      "Provide both startDate and endDate, or neither.",
    );
    expect(apiFetch).not.toHaveBeenCalled();

    await call("create_cycle", {
      projectId: "p 1",
      name: "Sprint",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/cycle/project/p%201",
        method: "POST",
        body: {
          name: "Sprint",
          startDate: "2026-10-01",
          endDate: "2026-10-14",
        },
      },
    ]);
  });

  it("rejects an impossible calendar date", async () => {
    const result = await call("create_cycle", {
      projectId: "p1",
      name: "Sprint",
      startDate: "2026-02-30",
      endDate: "2026-03-01",
    });
    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("adds then removes cycle tasks, deduplicated, in that order", async () => {
    const result = await call("update_cycle_tasks", {
      cycleId: "c1",
      addTaskIds: ["t1", "t1", "t2"],
      removeTaskIds: ["t3"],
    });
    expect(result.isError).toBeFalsy();
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/cycle/c1/tasks",
        method: "POST",
        body: { taskIds: ["t1", "t2"] },
      },
      {
        url: "http://api.test/api/cycle/c1/tasks",
        method: "DELETE",
        body: { taskIds: ["t3"] },
      },
    ]);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      added: { ok: true },
      removed: { ok: true },
    });
  });

  it("archives with the right route and filters modules by status", async () => {
    await call("set_cycle_archived", { cycleId: "c1", archived: false });
    await call("list_modules", {
      projectId: "p1",
      status: ["in-progress", "paused"],
      search: "auth",
    });
    expect(requests().map((request) => request.url)).toEqual([
      "http://api.test/api/cycle/c1/unarchive",
      "http://api.test/api/module/project/p1?status=in-progress%2Cpaused&search=auth",
    ]);
  });

  it("refuses an empty module patch and a start after the target date", async () => {
    expect((await call("update_module", { moduleId: "m1" })).isError).toBe(
      true,
    );
    expect(
      (
        await call("create_module", {
          projectId: "p1",
          name: "Auth",
          startDate: "2026-10-10",
          targetDate: "2026-10-01",
        })
      ).isError,
    ).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();

    await call("set_task_modules", { taskId: "t1", addModuleIds: ["m1"] });
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/module/task/t1",
        method: "PUT",
        body: { addModuleIds: ["m1"] },
      },
    ]);
  });

  it("checks each triage action's needs and sends only its fields", async () => {
    const noStatus = await call("triage_intake_item", {
      intakeItemId: "i1",
      action: "accept",
    });
    expect(noStatus.content[0]?.text).toContain("action accept needs status");
    const pastSnooze = await call("triage_intake_item", {
      intakeItemId: "i1",
      action: "snooze",
      until: "2020-01-01T00:00:00Z",
    });
    expect(pastSnooze.content[0]?.text).toContain("in the future");
    expect(apiFetch).not.toHaveBeenCalled();

    await call("triage_intake_item", {
      intakeItemId: "i1",
      action: "accept",
      status: "to-do",
      note: "ignored for accept",
    });
    await call("triage_intake_item", { intakeItemId: "i1", action: "reopen" });
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/intake/item/i1/accept",
        method: "POST",
        body: { status: "to-do" },
      },
      {
        url: "http://api.test/api/intake/item/i1/reopen",
        method: "POST",
        body: undefined,
      },
    ]);
  });

  it("lists pages without archived ones, and by parent", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json([
        { id: "root", parentId: null, archivedAt: null },
        { id: "child", parentId: "root", archivedAt: null },
        { id: "old", parentId: null, archivedAt: "2026-01-01T00:00:00Z" },
      ]),
    );
    const ids = async (args: Record<string, unknown>) =>
      (
        JSON.parse(
          (await call("list_pages", { projectId: "p1", ...args })).content[0]
            ?.text ?? "[]",
        ) as Array<{ id: string }>
      ).map((page) => page.id);

    expect(await ids({})).toEqual(["root", "child"]);
    expect(await ids({ includeArchived: true })).toEqual([
      "root",
      "child",
      "old",
    ]);
    expect(await ids({ parentId: null })).toEqual(["root"]);
    expect(await ids({ parentId: "root" })).toEqual(["child"]);
    expect(requests()[0]?.url).toBe("http://api.test/api/page/project/p1");
  });

  it("unlocks, patches and locks a page in that order", async () => {
    await call("update_page", { pageId: "pg1", title: "Spec", locked: false });
    await call("update_page", {
      pageId: "pg1",
      isFullWidth: true,
      locked: true,
    });
    expect(
      requests().map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "DELETE http://api.test/api/page/pg1/lock",
      "PATCH http://api.test/api/page/pg1",
      "PATCH http://api.test/api/page/pg1",
      "POST http://api.test/api/page/pg1/lock",
    ]);
    expect((await call("update_page", { pageId: "pg1" })).isError).toBe(true);
  });

  it("replaces content as markdown and searches pages", async () => {
    await call("replace_page_content", { pageId: "pg1", content: "# Plan" });
    await call("search", { q: "plan", type: "pages", workspaceId: "w1" });
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/page/pg1/content",
        method: "PUT",
        body: { markdown: "# Plan" },
      },
      {
        url: "http://api.test/api/search?q=plan&type=pages&workspaceId=w1",
        method: "GET",
        body: undefined,
      },
    ]);
  });

  it("lists automation rules and turns one on or off", async () => {
    await call("list_automation_rules", { projectId: "p 1" });
    await call("set_automation_rule_enabled", {
      projectId: "p1",
      ruleId: "r1",
      enabled: false,
    });
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/automation-rule/p%201",
        method: "GET",
        body: undefined,
      },
      {
        url: "http://api.test/api/automation-rule/p1/r1",
        method: "PATCH",
        body: { enabled: false },
      },
    ]);
  });
});
