import { describe, expect, it } from "vitest";
import { budgetStatusOf } from "../../../apps/api/src/ai-budget/status";
import {
  type FilterVocabulary,
  resolveFilterAnswer,
} from "../../../apps/api/src/ai-filters/resolve";
import { resolveDraftLabels } from "../../../apps/api/src/ai-triage/draft-labels";
import {
  cleanTitle,
  editorRequest,
  pageBlockRequest,
  toneRequest,
} from "../../../apps/api/src/ai-writing/prompts";
import {
  eventFacts,
  historyLine,
} from "../../../apps/api/src/ai-writing/task-summary";
import { digestRows } from "../../../apps/api/src/insight/inbox-digest";

describe("tone prompts", () => {
  it("adds a tone only to rewrites", () => {
    expect(toneRequest(undefined)).toBe("");
    expect(toneRequest("default")).toBe("");
    expect(editorRequest({ action: "improve" })).toContain(
      "same language and tone",
    );
    const professional = editorRequest({
      action: "improve",
      tone: "professional",
    });
    expect(professional).toContain("professional tone");
    expect(professional).not.toContain("and tone");
    expect(
      editorRequest({
        action: "custom",
        instruction: "Rewrite",
        tone: "casual",
      }),
    ).toContain("casual tone");
    expect(editorRequest({ action: "fix", tone: "casual" })).not.toContain(
      "tone",
    );
    expect(
      editorRequest({ action: "translate", language: "de-DE", tone: "casual" }),
    ).not.toContain("casual");
  });

  it("names each AI block preset", () => {
    expect(pageBlockRequest({ preset: "tldr" })).toContain("TL;DR");
    expect(pageBlockRequest({ preset: "faq" })).toContain("FAQ");
    expect(pageBlockRequest({ preset: "action_items" })).toContain("- [ ]");
    expect(
      pageBlockRequest({ preset: "custom", instruction: "A haiku" }),
    ).toContain("A haiku");
  });
});

describe("cleanTitle", () => {
  it("keeps one plain line", () => {
    expect(cleanTitle('# "Launch plan."\nmore')).toBe("Launch plan");
    expect(cleanTitle("\n\nTitle: Roadmap 2027")).toBe("Roadmap 2027");
    expect(cleanTitle("**Bold idea**")).toBe("Bold idea");
    expect(cleanTitle("   ")).toBe("");
    expect(cleanTitle("x".repeat(400))).toHaveLength(255);
  });
});

describe("task history lines", () => {
  it("keeps short scalar facts and skips ids", () => {
    expect(
      eventFacts({
        oldStatus: "to-do",
        newStatus: "done",
        userId: "u1",
        nested: { a: 1 },
      }),
    ).toBe("oldStatus: to-do, newStatus: done");
    expect(eventFacts(null)).toBe("");
    expect(
      historyLine({
        type: "priority_changed",
        createdAt: new Date("2026-10-20T10:00:00Z"),
        actor: null,
        external: "GitHub",
        content: null,
        eventData: { newPriority: "high" },
      }),
    ).toBe("2026-10-20 GitHub priority_changed (newPriority: high)");
  });
});

describe("draft label suggestions", () => {
  const labels = new Map([
    ["L1", { id: "bug", name: "Bug", color: "#f00" }],
    ["L2", { id: "ui", name: "UI", color: "#0f0" }],
    ["L3", { id: "api", name: "API", color: "#00f" }],
    ["L4", { id: "docs", name: "Docs", color: "#000" }],
  ]);

  it("drops unknown, repeated and existing labels and keeps three", () => {
    const result = resolveDraftLabels(
      {
        labels: [
          { ref: "l1", reason: "  a   bug " },
          { ref: "L1", reason: "again" },
          { ref: "L2", reason: "already set" },
          { ref: "L9", reason: "invented" },
          { ref: "L3", reason: "" },
          { ref: "L4", reason: "fourth" },
          { ref: 5 },
        ],
      },
      labels,
      new Set(["ui"]),
    );
    expect(result).toEqual([
      { labelId: "bug", name: "Bug", color: "#f00", reason: "a bug" },
      { labelId: "api", name: "API", color: "#00f", reason: null },
      { labelId: "docs", name: "Docs", color: "#000", reason: "fourth" },
    ]);
    expect(resolveDraftLabels("nonsense", labels, new Set())).toEqual([]);
  });
});

describe("natural-language filter resolution", () => {
  const vocabulary: FilterVocabulary = {
    keys: new Set([
      "status",
      "group",
      "priority",
      "assignee",
      "createdBy",
      "label",
      "cycle",
      "module",
      "dueDate",
      "createdAt",
    ]),
    statuses: [{ ref: "S1", id: "in-progress", name: "In Progress" }],
    labels: [{ ref: "L1", id: "label-bug", name: "Bug" }],
    people: [{ ref: "P1", id: "user-mia", name: "Mia" }],
    cycles: [{ ref: "C1", id: "cycle-1", name: "Sprint 1" }],
    modules: [],
    projects: [],
  };

  it("maps references, tokens and literals and drops the rest", () => {
    const result = resolveFilterAnswer(
      {
        op: "or",
        conditions: [
          { key: "label", operator: "in", values: ["L1", "L7"] },
          { key: "label", operator: "in", values: ["none"] },
          { key: "assignee", operator: "notIn", values: ["p1", "ME"] },
          { key: "cycle", operator: "in", values: ["C1", "current"] },
          { key: "group", operator: "in", values: ["Started", "doing"] },
          { key: "project", operator: "in", values: ["R1"] },
          {
            key: "dueDate",
            operator: "between",
            from: "2026-10-01",
            to: "2026-10-31",
          },
          { key: "createdAt", operator: "on", date: "not a date" },
          { key: "estimate", operator: "in", values: ["x"] },
          "junk",
        ],
        unmatched: ["  Sprint   9 "],
      },
      vocabulary,
    );
    expect(result.filters).toEqual({
      op: "or",
      children: [
        { key: "label", operator: "in", values: ["label-bug", "none"] },
        { key: "assignee", operator: "notIn", values: ["user-mia", "me"] },
        { key: "cycle", operator: "in", values: ["cycle-1", "current"] },
        { key: "group", operator: "in", values: ["started"] },
        {
          key: "dueDate",
          operator: "between",
          from: "2026-10-01",
          to: "2026-10-31",
        },
      ],
    });
    expect(result.dropped).toEqual(
      expect.arrayContaining([
        "Sprint 9",
        "L7",
        "doing",
        "project",
        "createdAt",
        "estimate",
      ]),
    );
  });

  it("keeps rolling date conditions within the engine's limits", () => {
    const ok = resolveFilterAnswer(
      {
        conditions: [
          {
            key: "dueDate",
            operator: "withinNext",
            amount: 2,
            unit: "weeks",
            values: ["ignored"],
          },
        ],
      },
      vocabulary,
    );
    expect(ok.filters?.children).toEqual([
      { key: "dueDate", operator: "withinNext", amount: 2, unit: "weeks" },
    ]);
    const tooFar = resolveFilterAnswer(
      {
        conditions: [
          { key: "dueDate", operator: "withinNext", amount: 900, unit: "days" },
        ],
      },
      vocabulary,
    );
    expect(tooFar.filters).toBeNull();
    expect(tooFar.dropped).toEqual(["dueDate"]);
  });

  it("answers null for nothing usable", () => {
    expect(resolveFilterAnswer(null, vocabulary)).toEqual({
      filters: null,
      dropped: [],
    });
  });
});

describe("budget status", () => {
  const now = new Date("2026-10-26T12:00:00Z");

  it("warns from 80% of the cap", () => {
    expect(budgetStatusOf(1_000_000, 799_999, now)).toMatchObject({
      usedPercent: 79,
      warning: false,
      month: "2026-10",
    });
    expect(budgetStatusOf(1_000_000, 800_000, now)).toMatchObject({
      usedPercent: 80,
      warning: true,
    });
    expect(budgetStatusOf(1_000_000, 1_500_000, now).usedPercent).toBe(150);
  });

  it("never warns without a cap", () => {
    expect(budgetStatusOf(null, 5_000_000, now)).toMatchObject({
      usedPercent: null,
      warning: false,
    });
  });
});

describe("inbox digest rows", () => {
  const base = {
    title: "t",
    content: null,
    createdAt: new Date("2026-10-26T08:00:00Z"),
    actor: null,
    eventData: null,
  };
  const task = (projectId: string) => ({
    id: `task-${projectId}`,
    key: "WEB-1",
    title: "Fix",
    projectId,
    projectName: "Web",
  });

  it("keeps tasks in the AI scope and workspace notices", () => {
    const items = [
      {
        ...base,
        type: "task_comment",
        resourceType: "task",
        task: task("web"),
      },
      {
        ...base,
        type: "task_comment",
        resourceType: "task",
        task: task("secret"),
      },
      {
        ...base,
        type: "ai_budget_warning",
        resourceType: "workspace",
        task: null,
      },
      { ...base, type: "page_mention", resourceType: "page", task: null },
      {
        ...base,
        type: "page_mention",
        resourceType: "page",
        task: null,
        eventData: { projectId: "web" },
      },
    ];
    const rows = digestRows(
      items as unknown as Parameters<typeof digestRows>[0],
      { projectIds: new Set(["web"]) },
    );
    expect(rows.map((row) => row.type)).toEqual([
      "task_comment",
      "ai_budget_warning",
      "page_mention",
    ]);
  });
});
