import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { errorResult, textResult } from "../utils/mcp-result.js";
import { mcpToolOutputSchema, structuredOf } from "./output.js";
import { registerTools } from "./register.js";

describe("structured tool output", () => {
  it("is byte-identical to the HTTP server's copy", () => {
    const here = readFileSync(new URL("./output.ts", import.meta.url), "utf8");
    const api = readFileSync(
      new URL("../../../../apps/api/src/mcp/output.ts", import.meta.url),
      "utf8",
    );
    expect(here).toBe(api);
  });

  it("returns JSON as structuredContent beside the text", () => {
    const result = textResult({ id: "t1" });
    expect(result.structuredContent).toEqual({ id: "t1" });
    expect(JSON.parse(result.content[0]?.text as string)).toEqual({
      id: "t1",
    });
    expect(textResult([{ id: "a" }]).structuredContent).toEqual({
      items: [{ id: "a" }],
    });
    expect(textResult("plain").structuredContent).toBeUndefined();
    expect(errorResult("boom").structuredContent).toBeUndefined();
  });

  it("registers output schemas for stable shapes only", () => {
    const configs = new Map<string, Record<string, unknown>>();
    const server = {
      registerTool: vi.fn(
        (name: string, config: Record<string, unknown>) =>
          void configs.set(name, config),
      ),
    };
    registerTools(server as never, { client: { json: vi.fn() } as never });

    expect(configs.get("get_task")?.outputSchema).toBe(
      mcpToolOutputSchema("get_task"),
    );
    expect(configs.get("list_projects")?.outputSchema).toBeDefined();
    expect(configs.get("search")?.outputSchema).toBeUndefined();
    expect(configs.get("get_task")?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(structuredOf(null)).toBeUndefined();
  });
});
