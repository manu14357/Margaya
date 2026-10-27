import { describe, expect, it } from "vitest";
import {
  eventsFromLinks,
  type SimColumn,
  type SimTask,
  type StatusChange,
  simulateWorkflowRule,
  statusAt,
  thresholdCrossedAt,
} from "../../../apps/api/src/ai-rule/simulate";
import {
  parseUnsupported,
  resolveRules,
  validateCompiledRule,
} from "../../../apps/api/src/ai-rule/validate";
import {
  compilerOutputSchema,
  modelJsonSchema,
} from "../../../apps/api/src/ai-rule/vocabulary";

// Rule compiler (C5): the engines' schemas as the model's output schema,
// validation of what comes back, and the pure history replay.

const columns = [
  { id: "c-todo", slug: "to-do", name: "To do", group: "unstarted" },
  { id: "c-review", slug: "in-review", name: "In review", group: "started" },
  { id: "c-done", slug: "done", name: "Done", group: "completed" },
  { id: "c-wont", slug: "wont-do", name: "Won't do", group: "cancelled" },
];

describe("rule compiler: output schema", () => {
  it("derives a strict JSON schema from the engines' Zod types", () => {
    const schema = modelJsonSchema(
      compilerOutputSchema({
        all: columns.map((column) => column.id),
        cancelled: ["c-wont"],
      }),
    );
    const text = JSON.stringify(schema);
    // Column ids are narrowed to the project's columns.
    expect(text).toContain('"enum":["c-todo","c-review","c-done","c-wont"]');
    expect(text).toContain('"enum":["c-wont"]');
    expect(text).toContain('"pr_merged"');
    expect(text).toContain('"autoArchive"');
    expect(text).toContain('"cycleRollover"');
    // Bounds are left to the Zod check after the call.
    expect(text).not.toContain("minimum");
    expect(text).not.toContain("$schema");
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (record.type === "object") objects.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(schema);
    expect(objects.length).toBeGreaterThan(3);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
    }
  });
});

describe("rule compiler: validation", () => {
  const workflow = {
    engine: "workflow_rule",
    rule: {
      integrationType: "github",
      eventType: "pr_merged",
      columnId: "c-done",
    },
  };

  it("accepts rules in the engines' exact schemas", () => {
    expect(validateCompiledRule(workflow, columns)).toEqual([]);
    expect(
      validateCompiledRule(
        {
          engine: "project_automation",
          patch: {
            autoClose: { enabled: true, months: 2, columnId: "c-wont" },
          },
        },
        columns,
      ),
    ).toEqual([]);
    expect(
      validateCompiledRule(
        {
          engine: "project_automation",
          patch: { cycleRollover: { enabled: true } },
        },
        columns,
      ),
    ).toEqual([]);
  });

  it("rejects invented triggers, actions, bounds and columns", () => {
    const invalid: unknown[] = [
      { ...workflow, rule: { ...workflow.rule, eventType: "status_changed" } },
      { ...workflow, rule: { ...workflow.rule, integrationType: "jira" } },
      { ...workflow, rule: { ...workflow.rule, columnId: "elsewhere" } },
      { ...workflow, rule: { ...workflow.rule, assigneeId: "priya" } },
      { engine: "label_rule", rule: { label: "needs-qa" } },
      { engine: "project_automation", patch: { autoArchive: { months: 13 } } },
      {
        engine: "project_automation",
        patch: { autoAssign: { enabled: true } },
      },
      { engine: "project_automation", patch: {} },
      {
        engine: "project_automation",
        patch: { autoClose: { enabled: true, columnId: "c-done" } },
      },
      { engine: "project_automation", patch: { autoClose: { enabled: true } } },
    ];
    for (const rule of invalid) {
      expect(
        validateCompiledRule(rule, columns),
        JSON.stringify(rule),
      ).not.toEqual([]);
    }
  });

  it("keeps valid rules, counts rejected ones and collapses duplicates", () => {
    const result = resolveRules(
      [
        workflow,
        { ...workflow, rule: { ...workflow.rule, columnId: "c-review" } },
        { engine: "workflow_rule", rule: { eventType: "label_added" } },
        "nonsense",
      ],
      columns,
    );
    expect(result.rejected).toBe(2);
    expect(result.rules).toEqual([
      { ...workflow, rule: { ...workflow.rule, columnId: "c-review" } },
    ]);
  });

  it("cleans the unsupported parts", () => {
    expect(
      parseUnsupported([
        {
          request: "  assign it to   Priya ",
          reason: "No engine assigns people.",
        },
        { request: "", reason: "empty" },
        { reason: "missing request" },
        "text",
      ]),
    ).toEqual([
      { request: "assign it to Priya", reason: "No engine assigns people." },
    ]);
    expect(parseUnsupported(null)).toEqual([]);
  });
});

describe("rule compiler: history replay", () => {
  const simColumns: SimColumn[] = columns.map((column) => ({
    id: column.id,
    slug: column.slug,
    name: column.name,
    isFinal: column.group === "completed" || column.group === "cancelled",
  }));
  const at = (iso: string) => new Date(iso);

  it("reads a task's status at a moment from its history", () => {
    const history: StatusChange[] = [
      {
        at: at("2026-10-05T10:00:00Z"),
        oldStatus: "to-do",
        newStatus: "in-review",
      },
      {
        at: at("2026-10-08T10:00:00Z"),
        oldStatus: "in-review",
        newStatus: "done",
      },
    ];
    expect(statusAt("done", history, at("2026-10-01T00:00:00Z"))).toBe("to-do");
    expect(statusAt("done", history, at("2026-10-06T00:00:00Z"))).toBe(
      "in-review",
    );
    expect(statusAt("done", history, at("2026-10-09T00:00:00Z"))).toBe("done");
  });

  it("replays events: moves, already-there and final-column skips", () => {
    const tasks = new Map<string, SimTask>([
      ["t1", { id: "t1", number: 1, title: "Login", status: "done" }],
      ["t2", { id: "t2", number: 2, title: "Signup", status: "in-review" }],
      ["t3", { id: "t3", number: 3, title: "Old", status: "done" }],
    ]);
    const histories = new Map<string, StatusChange[]>([
      [
        "t1",
        [
          {
            at: at("2026-10-10T00:00:00Z"),
            oldStatus: "to-do",
            newStatus: "done",
          },
        ],
      ],
    ]);
    const from = at("2026-10-01T00:00:00Z");
    const to = at("2026-10-20T00:00:00Z");
    const events = [
      {
        taskId: "t1",
        at: at("2026-10-05T00:00:00Z"),
        eventType: "pr_opened" as const,
      },
      {
        taskId: "t2",
        at: at("2026-10-06T00:00:00Z"),
        eventType: "pr_opened" as const,
      },
      {
        taskId: "t3",
        at: at("2026-10-07T00:00:00Z"),
        eventType: "pr_opened" as const,
      },
      // Outside the window, and another event type: ignored.
      {
        taskId: "t1",
        at: at("2026-09-01T00:00:00Z"),
        eventType: "pr_opened" as const,
      },
      {
        taskId: "t2",
        at: at("2026-10-06T00:00:00Z"),
        eventType: "pr_merged" as const,
      },
    ];
    const matches = simulateWorkflowRule({
      rule: { eventType: "pr_opened", columnId: "c-review" },
      events,
      tasks,
      histories,
      columns: simColumns,
      from,
      to,
    });
    expect(
      matches.map((match) => [
        match.taskId,
        match.outcome,
        match.from,
        match.to,
      ]),
    ).toEqual([
      ["t3", "skipped", "Done", "In review"],
      ["t2", "unchanged", "In review", "In review"],
      ["t1", "change", "To do", "In review"],
    ]);
  });

  it("dates events from the links the webhooks keep", () => {
    const created = at("2026-10-02T00:00:00Z");
    const updated = at("2026-10-04T00:00:00Z");
    const links = [
      {
        taskId: "a",
        createdAt: created,
        updatedAt: updated,
        metadata: JSON.stringify({
          merged: true,
          mergedAt: "2026-10-03T12:00:00Z",
        }),
      },
      {
        taskId: "b",
        createdAt: created,
        updatedAt: updated,
        metadata: JSON.stringify({ state: "open", merged: false }),
      },
      { taskId: "c", createdAt: created, updatedAt: updated, metadata: "{bad" },
    ];
    expect(eventsFromLinks("pr_merged", links)).toEqual([
      { taskId: "a", at: at("2026-10-03T12:00:00Z"), eventType: "pr_merged" },
    ]);
    expect(eventsFromLinks("pr_opened", links).map((e) => e.at)).toEqual([
      created,
      created,
      created,
    ]);
    const issues = [
      {
        taskId: "x",
        createdAt: created,
        updatedAt: updated,
        metadata: JSON.stringify({ state: "closed", createdFrom: "margaya" }),
      },
      {
        taskId: "y",
        createdAt: created,
        updatedAt: updated,
        metadata: JSON.stringify({ state: "closed", createdFrom: "github" }),
      },
    ];
    expect(eventsFromLinks("issue_closed", issues)).toEqual([
      { taskId: "y", at: updated, eventType: "issue_closed" },
    ]);
    expect(
      eventsFromLinks("issue_opened", issues).map((e) => e.taskId),
    ).toEqual(["y"]);
  });

  it("finds when a task crosses a months threshold", () => {
    expect(
      thresholdCrossedAt(at("2026-05-31T08:00:00Z"), 1).toISOString(),
    ).toBe("2026-06-30T08:00:00.000Z");
    expect(
      thresholdCrossedAt(at("2026-01-15T00:00:00Z"), 3).toISOString(),
    ).toBe("2026-04-15T00:00:00.000Z");
    expect(
      thresholdCrossedAt(at("2025-11-30T00:00:00Z"), 3).toISOString(),
    ).toBe("2026-02-28T00:00:00.000Z");
  });
});
