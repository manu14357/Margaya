import { describe, expect, it, vi } from "vitest";
import { PLANNING_TOOL_NAMES } from "./planning-tools.js";
import { registerTools } from "./register.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function setup() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler);
    }),
  };
  const client = { json: vi.fn().mockResolvedValue({ ok: true }) };
  registerTools(server as never, { client: client as never });
  const call = (name: string, args: Record<string, unknown>) => {
    const handler = tools.get(name);
    if (!handler) throw new Error(`Tool ${name} is not registered`);
    return handler(args);
  };
  return { tools, client, call };
}

describe("planning tools in the stdio catalog", () => {
  it("registers the cycle, module and intake tools", () => {
    const { tools } = setup();
    for (const name of PLANNING_TOOL_NAMES) expect(tools.has(name)).toBe(true);
  });

  it("lists cycles with a view and refuses a single cycle date", async () => {
    const { client, call } = setup();

    await call("list_cycles", { projectId: "p 1", view: "current" });
    expect(client.json).toHaveBeenCalledWith(
      "/api/cycle/project/p%201?view=current",
    );

    const refused = await call("create_cycle", {
      projectId: "p1",
      name: "Sprint",
      endDate: "2026-10-14",
    });
    expect(refused.isError).toBe(true);
    expect(client.json).toHaveBeenCalledTimes(1);
  });

  it("gets a module with its progress", async () => {
    const { client, call } = setup();

    const result = await call("get_module", {
      moduleId: "m1",
      includeProgress: true,
    });

    expect(client.json.mock.calls.map(([path]) => path)).toEqual([
      "/api/module/m1",
      "/api/module/m1/progress",
    ]);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      module: { ok: true },
      progress: { ok: true },
    });
  });

  it("submits an intake request and triages it as a duplicate", async () => {
    const { client, call } = setup();

    await call("submit_intake_item", {
      projectId: "p1",
      title: "Dark mode",
      priority: "high",
    });
    await call("triage_intake_item", {
      intakeItemId: "i1",
      action: "duplicate",
      duplicateOfTaskId: "t9",
      status: "to-do",
    });

    expect(client.json.mock.calls).toEqual([
      [
        "/api/intake/project/p1",
        {
          method: "POST",
          body: JSON.stringify({ title: "Dark mode", priority: "high" }),
        },
      ],
      [
        "/api/intake/item/i1/duplicate",
        { method: "POST", body: JSON.stringify({ duplicateOfTaskId: "t9" }) },
      ],
    ]);
  });

  it("renames and locks a page, locking last", async () => {
    const { client, call } = setup();

    await call("update_page", { pageId: "pg1", title: "Spec", locked: true });

    expect(client.json.mock.calls).toEqual([
      [
        "/api/page/pg1",
        { method: "PATCH", body: JSON.stringify({ title: "Spec" }) },
      ],
      ["/api/page/pg1/lock", { method: "POST" }],
    ]);
  });

  it("creates a private page under a parent and archives it", async () => {
    const { client, call } = setup();

    await call("create_page", {
      projectId: "p1",
      title: "Notes",
      content: "Hello",
      parentId: "root",
      access: "private",
    });
    await call("set_page_archived", { pageId: "pg1", archived: true });

    expect(client.json.mock.calls).toEqual([
      [
        "/api/page/project/p1",
        {
          method: "POST",
          body: JSON.stringify({
            title: "Notes",
            content: "Hello",
            parentId: "root",
            access: "private",
          }),
        },
      ],
      ["/api/page/pg1/archive", { method: "POST" }],
    ]);
  });
});
