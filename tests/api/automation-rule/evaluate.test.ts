import { describe, expect, it } from "vitest";
import {
  conditionsHold,
  renderTemplate,
  type TaskFacts,
  type TriggerEvent,
  triggerMatches,
} from "../../../apps/api/src/automation-rule/evaluate";
import {
  automationRuleDefinitionSchema,
  unknownTemplateVariables,
} from "../../../apps/api/src/automation-rule/vocabulary";

const refs = {
  columnSlugs: new Map([
    ["col-todo", "to-do"],
    ["col-review", "in-review"],
    ["col-done", "done"],
  ]),
};

function task(overrides: Partial<TaskFacts> = {}): TaskFacts {
  return {
    id: "t1",
    projectId: "p1",
    number: 7,
    title: "Login <b>bug</b> on Safari",
    status: "in-review",
    columnId: "col-review",
    priority: "high",
    dueDate: null,
    estimate: 3,
    estimateSet: true,
    assigneeIds: ["priya"],
    labels: ["bug"],
    customFields: { f1: "web" },
    createdBy: "sam",
    projectSlug: "web",
    projectName: "Web",
    leadId: "lee",
    ...overrides,
  };
}

const base = { projectId: "p1", taskId: "t1" };

describe("automation triggers", () => {
  it("matches a status change by column ids, from and to", () => {
    const event: TriggerEvent = {
      ...base,
      type: "status_changed",
      from: "to-do",
      to: "in-review",
    };
    expect(
      triggerMatches(
        { type: "status_changed", to: ["col-review"] },
        event,
        refs,
      ),
    ).toBe(true);
    expect(
      triggerMatches({ type: "status_changed", to: ["col-done"] }, event, refs),
    ).toBe(false);
    expect(
      triggerMatches(
        { type: "status_changed", from: ["col-done"], to: ["col-review"] },
        event,
        refs,
      ),
    ).toBe(false);
    expect(triggerMatches({ type: "status_changed" }, event, refs)).toBe(true);
  });

  it("never matches another trigger type", () => {
    expect(
      triggerMatches(
        { type: "priority_changed" },
        { ...base, type: "comment_added" },
        refs,
      ),
    ).toBe(false);
  });

  it("filters intake creations, labels, people, cycles and priorities", () => {
    expect(
      triggerMatches(
        { type: "task_created", fromIntake: true },
        { ...base, type: "task_created", fromIntake: false },
        refs,
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        { type: "label_added", labels: ["Bug"] },
        { ...base, type: "label_added", label: "bug" },
        refs,
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        { type: "assignee_added", userIds: ["ana"] },
        { ...base, type: "assignee_added", userId: "ben" },
        refs,
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        { type: "moved_to_cycle", cycleIds: ["c1"] },
        { ...base, type: "moved_to_cycle", cycleId: "c1" },
        refs,
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        { type: "priority_changed", to: ["urgent"] },
        { ...base, type: "priority_changed", to: "high" },
        refs,
      ),
    ).toBe(false);
  });
});

describe("automation conditions", () => {
  it("holds with no conditions", () => {
    expect(conditionsHold(null, task(), refs)).toBe(true);
  });

  it("checks every field", () => {
    const holds = (condition: unknown) =>
      conditionsHold(
        { op: "and", conditions: [condition] } as never,
        task(),
        refs,
      );
    expect(
      holds({ field: "status", op: "is", columnIds: ["col-review"] }),
    ).toBe(true);
    expect(
      holds({ field: "status", op: "is_not", columnIds: ["col-review"] }),
    ).toBe(false);
    expect(holds({ field: "labels", op: "contains", labels: ["BUG"] })).toBe(
      true,
    );
    expect(
      holds({ field: "labels", op: "not_contains", labels: ["bug"] }),
    ).toBe(false);
    expect(
      holds({ field: "priority", op: "is", values: ["high", "urgent"] }),
    ).toBe(true);
    expect(holds({ field: "assignee", op: "is", userIds: ["priya"] })).toBe(
      true,
    );
    expect(holds({ field: "assignee", op: "empty" })).toBe(false);
    expect(holds({ field: "due_date", op: "not_set" })).toBe(true);
    expect(holds({ field: "estimate", op: "gte", value: 3 })).toBe(true);
    expect(holds({ field: "estimate", op: "lte", value: 2 })).toBe(false);
    expect(holds({ field: "title", op: "contains", value: "SAFARI" })).toBe(
      true,
    );
    expect(
      holds({
        field: "custom_field",
        fieldId: "f1",
        op: "equals",
        value: "web",
      }),
    ).toBe(true);
    expect(
      holds({
        field: "custom_field",
        fieldId: "f2",
        op: "not_equals",
        value: "x",
      }),
    ).toBe(true);
  });

  it("combines AND and OR groups", () => {
    const group = {
      op: "and" as const,
      conditions: [
        { field: "labels" as const, op: "contains" as const, labels: ["bug"] },
        {
          op: "or" as const,
          conditions: [
            {
              field: "priority" as const,
              op: "is" as const,
              values: ["urgent" as const],
            },
            { field: "assignee" as const, op: "empty" as const },
          ],
        },
      ],
    };
    expect(conditionsHold(group, task(), refs)).toBe(false);
    expect(conditionsHold(group, task({ assigneeIds: [] }), refs)).toBe(true);
    expect(conditionsHold(group, task({ priority: "urgent" }), refs)).toBe(
      true,
    );
  });
});

describe("automation templates", () => {
  it("fills variables and escapes markup", () => {
    expect(
      renderTemplate(
        "{{task.key}}: {{ task.title }} is {{task.status}} ({{rule.name}}) {{nope}}",
        { task: task(), statusName: "In review", ruleName: "QA" },
      ),
    ).toBe("WEB-7: Login &lt;b&gt;bug&lt;/b&gt; on Safari is In review (QA) ");
  });

  it("reports unknown variables", () => {
    expect(
      unknownTemplateVariables("Hi {{task.title}} {{task.owner}}"),
    ).toEqual(["task.owner"]);
  });
});

describe("automation rule schema", () => {
  it("accepts the reviewer example and rejects unknown actions", () => {
    const rule = {
      name: "Assign reviewer",
      trigger: { type: "status_changed", to: ["col-review"] },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["bug"] }],
      },
      actions: [
        { type: "assign", userIds: ["priya"] },
        { type: "add_label", label: "needs-qa" },
      ],
    };
    expect(automationRuleDefinitionSchema.safeParse(rule).success).toBe(true);
    expect(
      automationRuleDefinitionSchema.safeParse({
        ...rule,
        actions: [{ type: "delete_task" }],
      }).success,
    ).toBe(false);
    expect(
      automationRuleDefinitionSchema.safeParse({ ...rule, actions: [] })
        .success,
    ).toBe(false);
  });
});
