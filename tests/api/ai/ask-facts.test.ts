import { describe, expect, it } from "vitest";
import type { AiScope } from "../../../apps/api/src/ai/context";
import type { AiResult } from "../../../apps/api/src/ai/gateway";
import { assertAnswered } from "../../../apps/api/src/ai/sse";
import {
  type AskFacts,
  factsItem,
  formatAskFacts,
} from "../../../apps/api/src/ai-ask/facts";

const facts: AskFacts = {
  projects: ["Website"],
  today: "2026-10-22",
  timeZone: "Europe/Berlin",
  total: 12,
  open: 9,
  completed: 2,
  cancelled: 1,
  overdue: 3,
  dueSoon: 2,
  completedLast7Days: 1,
  byProject: null,
  byStatus: [
    { label: "To do", group: "unstarted", total: 5, open: 5 },
    { label: "In progress", group: "started", total: 4, open: 4 },
    { label: "Done", group: "completed", total: 2, open: 0 },
    { label: "Won't do", group: "cancelled", total: 1, open: 0 },
  ],
  byGroup: [
    { group: "unstarted", total: 5 },
    { group: "started", total: 4 },
    { group: "completed", total: 2 },
    { group: "cancelled", total: 1 },
  ],
  byPriority: [
    { label: "High", total: 4, open: 4 },
    { label: "Low", total: 8, open: 5 },
  ],
  byAssignee: [
    { label: "Ada", total: 6, open: 4 },
    { label: "Unassigned", total: 6, open: 5 },
  ],
  byLabel: [{ label: "No label", total: 12, open: 9 }],
  byCycle: null,
  byModule: [
    { label: "Checkout", total: 3, open: 3 },
    { label: "No module", total: 9, open: 6 },
  ],
  more: { assignee: 4 },
};

describe("Ask facts", () => {
  it("formats totals and breakdowns as plain lines", () => {
    const text = formatAskFacts(facts);
    expect(text).toContain('project "Website", today 2026-10-22');
    expect(text).toContain(
      "Tasks: 12 total, 9 open, 3 closed (2 completed, 1 cancelled).",
    );
    expect(text).toContain(
      "Overdue (open, due before today): 3. Due in the next 7 days (open): 2.",
    );
    expect(text).toContain(
      "Completed in the last 7 days (today and the 6 days before): 1.",
    );
    expect(text).toContain(
      [
        "By status column, in board order:",
        "- To do (unstarted): 5",
        "- In progress (started): 4",
        "- Done (completed): 2",
        "- Won't do (cancelled): 1",
      ].join("\n"),
    );
    expect(text).toContain("- High: 4\n- Low: 8 (5 open)");
    expect(text).toContain("- Unassigned: 6 (5 open)\n- (4 more not listed)");
    expect(text).toContain("By module (a task in several modules");
    // Features that are off leave their section out.
    expect(text).not.toContain("By cycle");
    expect(text).not.toContain("By project");
  });

  it("names every project and lists them when there are several", () => {
    const text = formatAskFacts({
      ...facts,
      projects: ["Website", "API"],
      byProject: [
        { label: "Website", total: 12, open: 9 },
        { label: "API", total: 0, open: 0 },
      ],
    });
    expect(text).toContain("2 projects (Website, API)");
    expect(text).toContain("By project:\n- Website: 12 (9 open)\n- API: 0");
  });

  it("builds an uncited item with the strictest data tier", () => {
    const scope = {
      workspaceId: "w",
      userId: "u",
      projectIds: new Set(["p1", "p2"]),
      restrictedProjectIds: new Set(["p2"]),
      excludedProjectIds: new Set<string>(),
      can: { readTasks: true, readPages: true },
    } satisfies AiScope;
    const single = factsItem(scope, facts, ["p1"]);
    expect(single.ref).toBeNull();
    expect(single.projectId).toBe("p1");
    expect(single.source.startsWith("facts:")).toBe(true);
    expect(single.dataTier).toBe("private");
    const both = factsItem(scope, { ...facts, projects: ["Website", "API"] }, [
      "p1",
      "p2",
    ]);
    expect(both.projectId).toBeNull();
    expect(both.source).toBe("facts:counts");
    expect(both.dataTier).toBe("restricted");
  });
});

describe("AI answers cut off before any text", () => {
  const result = (patch: Partial<AiResult>): AiResult => ({
    text: "",
    toolCalls: [],
    stop: "end_turn",
    usage: { input: 1, output: 1500, cacheRead: 0, cacheWrite: 0 },
    costMicros: 0,
    meta: {} as AiResult["meta"],
    ...patch,
  });

  it("turns an empty max_tokens answer into a provider error", () => {
    expect(() =>
      assertAnswered(result({ stop: "max_tokens", text: " \n" })),
    ).toThrowError(/ran out of room/);
    try {
      assertAnswered(result({ stop: "max_tokens" }));
    } catch (error) {
      expect((error as { code?: string }).code).toBe("AI_PROVIDER_ERROR");
    }
  });

  it("keeps partial answers, tool calls and empty refusals as before", () => {
    expect(() =>
      assertAnswered(result({ stop: "max_tokens", text: "Partial" })),
    ).not.toThrow();
    expect(() =>
      assertAnswered(
        result({
          stop: "max_tokens",
          toolCalls: [{ id: "1", name: "x", input: {} }],
        }),
      ),
    ).not.toThrow();
    expect(() => assertAnswered(result({ stop: "refusal" }))).toThrowError(
      /declined/,
    );
    expect(() => assertAnswered(result({}))).not.toThrow();
  });
});
