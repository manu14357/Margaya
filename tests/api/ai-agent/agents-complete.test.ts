import { describe, expect, it, vi } from "vitest";

// Pure pieces of agent schedules, templates, project scope, resumed runs
// and the outbound MCP client. Nothing here touches the database.
vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../../apps/api/src/ai-agent/events", () => ({
  publishRunUpdated: vi.fn(),
}));

const { CronError, nextRunAfter, validateSchedule } = await import(
  "../../../apps/api/src/ai-agent/cron"
);
const { AGENT_TEMPLATES } = await import(
  "../../../apps/api/src/ai-agent/templates"
);
const { allowListed, progressLines, triggerNote } = await import(
  "../../../apps/api/src/ai-agent/run-context"
);
const {
  McpError,
  parseRpcResponse,
  splitSseEvents,
  toolResultText,
  toolsFromList,
} = await import("../../../apps/api/src/ai-connectors/mcp-client");
const { connectorSlug, connectorToolName, modelSchema } = await import(
  "../../../apps/api/src/ai-connectors/agent-tools"
);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof CronError ? error.code : "OTHER";
  }
  return null;
};

describe("agent schedule cron", () => {
  const monday = new Date("2026-10-26T12:00:00.000Z");

  it("computes the next run in the schedule's time zone", () => {
    // 09:00 in New York is 13:00 UTC in late October (EDT).
    expect(
      nextRunAfter("0 9 * * 1-5", "America/New_York", monday)?.toISOString(),
    ).toBe("2026-10-26T13:00:00.000Z");
    expect(
      nextRunAfter(
        "0 9 * * 1-5",
        "America/New_York",
        new Date("2026-10-26T14:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-27T13:00:00.000Z");
    // Friday evening → next Monday.
    expect(
      nextRunAfter(
        "0 9 * * 1-5",
        "Europe/Berlin",
        new Date("2026-10-30T18:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-11-02T08:00:00.000Z");
  });

  it("follows daylight saving time changes", () => {
    // Berlin leaves summer time on 25 October 2026: 9:00 is 07:00 UTC
    // before and 08:00 UTC after.
    expect(
      nextRunAfter(
        "0 9 * * *",
        "Europe/Berlin",
        new Date("2026-10-24T00:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-24T07:00:00.000Z");
    expect(
      nextRunAfter(
        "0 9 * * *",
        "Europe/Berlin",
        new Date("2026-10-25T00:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-25T08:00:00.000Z");
  });

  it("validates and normalizes a schedule", () => {
    expect(validateSchedule("  0  9 1 * * ", "UTC", monday)).toEqual({
      cron: "0 9 1 * *",
      nextRunAt: new Date("2026-11-01T09:00:00.000Z"),
    });
    expect(validateSchedule("*/15 * * * *", "UTC", monday).cron).toBe(
      "*/15 * * * *",
    );
  });

  it("refuses bad patterns, zones and loops tighter than 15 minutes", () => {
    expect(code(() => validateSchedule("0 9 * *", "UTC"))).toBe("CRON_INVALID");
    expect(code(() => validateSchedule("0 0 9 * * *", "UTC"))).toBe(
      "CRON_INVALID",
    );
    expect(code(() => validateSchedule("99 9 * * *", "UTC"))).toBe(
      "CRON_INVALID",
    );
    expect(code(() => validateSchedule("0 9 * * *", "Mars/Olympus"))).toBe(
      "TIMEZONE_INVALID",
    );
    expect(code(() => validateSchedule("* * * * *", "UTC"))).toBe(
      "CRON_TOO_FREQUENT",
    );
    expect(code(() => validateSchedule("*/10 * * * *", "UTC"))).toBe(
      "CRON_TOO_FREQUENT",
    );
    expect(code(() => validateSchedule("0,5 9 * * *", "UTC"))).toBe(
      "CRON_TOO_FREQUENT",
    );
    expect(nextRunAfter("nonsense", "UTC", monday)).toBeNull();
  });
});

describe("agent templates", () => {
  it("has the five templates with usable defaults", () => {
    expect(AGENT_TEMPLATES.map((t) => t.id)).toEqual([
      "triage",
      "standup",
      "specWriter",
      "deliveryRisk",
      "feedback",
    ]);
    for (const template of AGENT_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(2);
      expect(template.instructions.length).toBeGreaterThan(80);
      expect(template.instructions.length).toBeLessThanOrEqual(8_000);
      expect(["fast", "balanced", "deep"]).toContain(template.modelTier);
      expect(["member", "viewer"]).toContain(template.role);
      expect(template.suggestedTriggers.length).toBeGreaterThan(0);
      if (template.suggestedSchedule) {
        expect(template.suggestedTriggers).toContain("schedule");
        expect(() =>
          validateSchedule(template.suggestedSchedule?.cron ?? "", "UTC"),
        ).not.toThrow();
        expect(template.suggestedSchedule.prompt.length).toBeLessThan(4_000);
      }
    }
  });

  it("suggests a weekday schedule for the standup summarizer", () => {
    const standup = AGENT_TEMPLATES.find((t) => t.id === "standup");
    expect(standup?.suggestedSchedule?.cron).toBe("0 9 * * 1-5");
  });
});

describe("agent project scope", () => {
  it("keeps every reachable project without an allow-list", () => {
    expect([...allowListed(["a", "b"], null)]).toEqual(["a", "b"]);
  });

  it("cuts the reach down to the allow-list, never adding to it", () => {
    expect([...allowListed(["a", "b", "c"], ["c", "a", "z"])]).toEqual([
      "a",
      "c",
    ]);
    expect([...allowListed(["a"], [])]).toEqual([]);
  });
});

describe("run prompts", () => {
  it("explains each trigger", () => {
    expect(
      triggerNote("manual", { canComment: true, hasTask: true }),
    ).toBeNull();
    expect(
      triggerNote("schedule", { canComment: true, hasTask: false }),
    ).toContain("project page");
    expect(
      triggerNote("automation", { canComment: true, hasTask: true }),
    ).toContain("automation rule");
    expect(triggerNote("chat", { canComment: false, hasTask: true })).toContain(
      "follow-up",
    );
    expect(
      triggerNote("mention", { canComment: false, hasTask: true }),
    ).toContain("can't comment");
  });

  it("rebuilds what a paused run did from its steps", () => {
    expect(
      progressLines([
        { kind: "model", toolName: null, resultStatus: "ok", change: null },
        {
          kind: "tool",
          toolName: "read_task",
          resultStatus: "ok",
          change: null,
        },
        {
          kind: "tool",
          toolName: "move_status",
          resultStatus: "applied",
          change: {
            op: "set_status",
            taskId: "t1",
            projectId: "p1",
            taskLabel: "WEB-1 Login",
            before: { status: "to-do" },
            after: { status: "done" },
          },
        },
        {
          kind: "tool",
          toolName: "ask_person",
          resultStatus: "ok",
          change: null,
        },
        {
          kind: "tool",
          toolName: "delete_task",
          resultStatus: "pending",
          change: {
            op: "delete_task",
            taskId: "t2",
            projectId: "p1",
            taskLabel: "WEB-2 Old",
          },
        },
      ]),
    ).toEqual([
      "- Used read_task",
      "- Move WEB-1 Login to done (applied)",
      "- Delete WEB-2 Old (waiting for approval)",
    ]);
  });
});

describe("MCP client parsing", () => {
  it("reads a JSON answer and a JSON batch", () => {
    expect(
      parseRpcResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }),
        "application/json",
        2,
      ).result,
    ).toEqual({ ok: true });
    expect(
      parseRpcResponse(
        JSON.stringify([
          { jsonrpc: "2.0", method: "notifications/progress" },
          { jsonrpc: "2.0", id: 3, result: 7 },
        ]),
        "application/json; charset=utf-8",
        3,
      ).result,
    ).toBe(7);
  });

  it("reads the matching answer from an event stream", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
      "",
      "id: 9",
      'data: {"jsonrpc":"2.0","id":4,',
      'data: "result":{"tools":[]}}',
      "",
    ].join("\r\n");
    expect(parseRpcResponse(body, "text/event-stream", 4).result).toEqual({
      tools: [],
    });
    expect(splitSseEvents("data: a\n\ndata: b").events).toEqual(["a"]);
  });

  it("refuses answers to another request or no JSON-RPC at all", () => {
    expect(() =>
      parseRpcResponse(
        '{"jsonrpc":"2.0","id":1,"result":1}',
        "application/json",
        2,
      ),
    ).toThrow(McpError);
    expect(() => parseRpcResponse("<html>", "text/html", 1)).toThrow(McpError);
  });

  it("cleans the tool list and reads the read-only hint", () => {
    const { tools, nextCursor } = toolsFromList({
      tools: [
        {
          name: "search_issues",
          description: "Find issues",
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" } },
          },
          annotations: { readOnlyHint: true },
        },
        { name: "create_issue", inputSchema: { properties: {} } },
        { description: "no name" },
        "junk",
      ],
      nextCursor: "page-2",
    });
    expect(nextCursor).toBe("page-2");
    expect(tools).toEqual([
      {
        name: "search_issues",
        description: "Find issues",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
        readOnly: true,
      },
      {
        name: "create_issue",
        description: "",
        inputSchema: { properties: {}, type: "object" },
        readOnly: false,
      },
    ]);
    expect(() => toolsFromList({})).toThrow(McpError);
  });

  it("turns a tool result into text", () => {
    expect(
      toolResultText({
        content: [
          { type: "text", text: "Issue #1" },
          { type: "image", data: "…" },
          { type: "resource", resource: { uri: "x", text: "body" } },
        ],
      }),
    ).toEqual({ text: "Issue #1\n\n[image]\n\nbody", isError: false });
    expect(
      toolResultText({
        content: [],
        structuredContent: { n: 1 },
        isError: true,
      }),
    ).toEqual({ text: '{"n":1}', isError: true });
  });
});

describe("connector tool names", () => {
  it("namespaces tools within 64 safe characters", () => {
    expect(connectorSlug("Acme Issues!")).toBe("acme_issues");
    expect(connectorSlug("¡¡¡")).toBe("mcp");
    expect(connectorToolName("acme_issues", "search.issues")).toBe(
      "connector_acme_issues__search_issues",
    );
    const long = connectorToolName("a".repeat(20), "b".repeat(80));
    expect(long.length).toBe(64);
    expect(long).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("bounds the schema the model gets", () => {
    expect(modelSchema({ $schema: "x", properties: {} })).toEqual({
      properties: {},
      type: "object",
    });
    const huge = { properties: { a: { description: "x".repeat(9_000) } } };
    expect(modelSchema(huge)).toEqual({
      type: "object",
      additionalProperties: true,
    });
  });
});
