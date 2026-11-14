import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpToolAnnotations } from "../../../apps/api/src/mcp/annotations";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../../apps/api/src/mcp/tools";
import { parseElement } from "../../../apps/api/src/whiteboard/board";

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

const content = {
  elements: [
    {
      id: "a",
      type: "sticky",
      text: "Ship it",
      order: "a1",
      x: 0,
      y: 10,
      width: 200,
    },
    {
      id: "b",
      type: "frame",
      name: "Sprint 12",
      order: "a3",
      x: 300,
      y: 40,
      width: 100,
    },
    { id: "c", type: "task", taskId: "t1", order: "a2", x: 0, y: 0, width: 1 },
    { id: "d", type: "text", text: "gone", deleted: true, order: "a9" },
  ],
  settings: { background: "#ffffff", gridSize: 0 },
  contentVersion: 4,
};

function requests() {
  return apiFetch.mock.calls.map(([input, init]) => ({
    url: String(input),
    method: (init as RequestInit | undefined)?.method ?? "GET",
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }));
}

beforeEach(() => {
  apiFetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/content")) return Response.json(content);
    if (url.endsWith("/elements")) {
      return Response.json({ elements: [], skipped: 0, contentVersion: 5 });
    }
    return Response.json({ id: "w1", title: "Planning", projectId: "p1" });
  });
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whiteboard MCP tools", () => {
  it("classifies reads and the sticky write", () => {
    expect(mcpToolAnnotations("list_whiteboards").readOnlyHint).toBe(true);
    expect(mcpToolAnnotations("get_whiteboard").readOnlyHint).toBe(true);
    expect(mcpToolAnnotations("add_whiteboard_sticky")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it("lists a project's boards", async () => {
    await call("list_whiteboards", { projectId: "p 1", query: "retro" });
    expect(requests()).toEqual([
      {
        url: "http://api.test/api/whiteboard?projectId=p+1&q=retro",
        method: "GET",
        body: undefined,
      },
    ]);
  });

  it("reads a board as text and element counts", async () => {
    const result = await call("get_whiteboard", { id: "w1" });
    const parsed = JSON.parse(result.content[0]?.text ?? "{}");
    expect(parsed).toMatchObject({
      id: "w1",
      title: "Planning",
      elementCount: 3,
      elementCounts: { sticky: 1, frame: 1, task: 1 },
      text: "Ship it\nSprint 12",
    });
  });

  it("adds a valid sticky on top, to the right of the board", async () => {
    await call("add_whiteboard_sticky", {
      id: "w1",
      text: "New idea",
      color: "pink",
    });
    const post = requests().find((request) => request.method === "POST");
    expect(post?.url).toBe("http://api.test/api/whiteboard/w1/elements");
    const [sticky] = post?.body.elements ?? [];
    expect(sticky).toMatchObject({
      type: "sticky",
      text: "New idea",
      fillColor: "#fcc2d7",
      x: 440,
      y: 0,
    });
    // Above every live element's order.
    expect(sticky.order > "a3").toBe(true);
    // The board model accepts it as it is.
    expect(parseElement(sticky)).toMatchObject({
      id: sticky.id,
      type: "sticky",
      text: "New idea",
      order: sticky.order,
    });
  });

  it("refuses bad colours and empty text before calling the API", async () => {
    const result = await call("add_whiteboard_sticky", {
      id: "w1",
      text: "x",
      color: "url(javascript:1)",
    });
    expect(result.isError).toBe(true);
    const empty = await call("add_whiteboard_sticky", { id: "w1", text: " " });
    expect(empty.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
