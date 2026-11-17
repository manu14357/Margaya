import { describe, expect, it } from "vitest";
import {
  buildRule,
  buildTaskTemplates,
  buildView,
  placeholderRefs,
  planSampleData,
} from "../../../apps/api/src/project-template/build";
import { resolveTemplate } from "../../../apps/api/src/project-template/resolve";
import { createTextSource } from "../../../apps/api/src/project-template/text";
import type { ProjectTemplate } from "../../../apps/api/src/project-template/types";

const t = (key: string) => `projectTemplates:content.desk.${key}` as const;

const desk: ProjectTemplate = {
  id: "desk",
  version: 1,
  categories: ["service-management"],
  icon: "MessageSquare",
  name: "projectTemplates:catalog.desk.name",
  pitch: "projectTemplates:catalog.desk.pitch",
  description: "projectTemplates:catalog.desk.description",
  suggestedKey: "DSK",
  project: {
    features: {
      cycles: true,
      modules: true,
      views: true,
      pages: true,
      whiteboards: false,
      intake: true,
      estimates: true,
      timeTracking: false,
      ai: false,
      updates: false,
    },
  },
  columns: [
    { key: "new", name: t("new"), group: "unstarted" },
    { key: "doing", name: t("doing"), group: "started" },
    { key: "done", name: t("done"), group: "completed" },
  ],
  labels: [
    { key: "vip", name: t("vip"), color: "red" },
    { key: "bug", name: t("bug"), color: "orange" },
  ],
  customFields: [
    {
      key: "impact",
      name: t("impact"),
      type: "dropdown",
      options: [
        { key: "me", label: t("me") },
        { key: "many", label: t("many") },
      ],
    },
  ],
  estimate: { name: t("estimate"), type: "points", values: ["1", "3"] },
  modules: [{ key: "q1", name: t("q1") }],
  taskTemplates: [
    {
      name: t("tplName"),
      column: "doing",
      labels: ["vip", "bug"],
      assignee: "creator",
      estimateValue: "3",
      subtasks: [t("sub")],
    },
  ],
  views: [
    {
      name: t("view"),
      filters: {
        root: {
          op: "and",
          children: [
            { key: "status", operator: "in", columns: ["new", "doing"] },
            {
              key: "label",
              operator: "notIn",
              labels: ["vip"],
              includeNone: true,
            },
            {
              key: "customField",
              field: "impact",
              operator: "in",
              options: ["many", "none"],
            },
            { key: "module", operator: "in", modules: ["q1"] },
          ],
        },
      },
      display: {
        layout: "board",
        groupBy: { customField: "impact" },
        orderBy: { field: "dueDate" },
      },
      displayProperties: { customFields: ["impact"], startDate: true },
    },
  ],
  automationRules: [
    {
      name: t("rule"),
      trigger: { type: "status_changed", to: ["done"] },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "impact",
            op: "equals",
            value: "many",
          },
        ],
      },
      actions: [
        { type: "add_label", label: "vip" },
        { type: "notify", roles: ["lead"], message: t("message") },
      ],
    },
    {
      name: t("rule2"),
      trigger: { type: "task_created", fromIntake: true },
      actions: [
        { type: "set_status", column: "doing" },
        { type: "assign", person: "creator" },
      ],
    },
  ],
  sample: {
    cycles: [{ name: t("cycle"), startInDays: -2, lengthDays: 14 }],
    tasks: [
      {
        key: "a",
        title: t("a"),
        column: "new",
        labels: ["vip"],
        dueInDays: 3,
        customFields: { impact: "many" },
        cycle: 0,
        module: "q1",
        subtasks: [t("a1"), t("a2")],
        relations: [{ type: "blocks", to: "b" }],
        recurrence: { frequency: "monthly", monthDay: 5, trigger: "schedule" },
      },
      { key: "b", title: t("b"), column: "doing", estimateValue: "1" },
      {
        key: "c",
        title: t("c"),
        column: "done",
        relations: [{ type: "related", to: "a" }],
      },
    ],
  },
};

const words = Object.fromEntries(
  [
    "new",
    "doing",
    "done",
    "vip",
    "bug",
    "impact",
    "me",
    "many",
    "estimate",
    "q1",
    "tplName",
    "sub",
    "view",
    "rule",
    "rule2",
    "message",
    "cycle",
    "a",
    "a1",
    "a2",
    "b",
    "c",
  ].map((key) => [
    key,
    key === "message" ? "Done: {{task.title}}" : `${key} text`,
  ]),
);
const source = createTextSource({
  "en-US": {
    projectTemplates: {
      catalog: { desk: { name: "Desk", pitch: "p", description: "d" } },
      content: { desk: words },
    },
  },
});
const resolved = resolveTemplate(desk, "en-US", source);

describe("buildTaskTemplates", () => {
  it("maps keys to ids and drops skipped labels", () => {
    const [row] = buildTaskTemplates(
      resolved,
      placeholderRefs(new Set(["bug"])),
    );
    expect(row).toMatchObject({
      name: "tplName text",
      columnId: "column-doing",
      labelIds: ["label-vip"],
      assigneeIds: ["user-template-check"],
      estimatePointId: "point-3",
      subtasks: ["sub text"],
    });
  });
});

describe("buildView", () => {
  it("resolves slugs, label names, field ids and option text", () => {
    const view = buildView(
      resolved,
      desk.views?.[0] as never,
      placeholderRefs(),
    );
    expect(view.filters.root).toEqual({
      op: "and",
      children: [
        { key: "status", operator: "in", values: ["new-text", "doing-text"] },
        { key: "label", operator: "notIn", values: ["name:vip text", "none"] },
        {
          key: "customField",
          operator: "in",
          fieldId: "field-impact",
          values: ["many text", "none"],
        },
        { key: "module", operator: "in", values: ["module-q1"] },
      ],
    });
    expect(view.display).toMatchObject({
      layout: "board",
      groupBy: "customField:field-impact",
      orderBy: { field: "dueDate", direction: "asc" },
    });
    expect(view.displayProperties).toMatchObject({
      customFields: ["field-impact"],
      startDate: true,
      key: true,
    });
  });
});

describe("buildRule", () => {
  it("builds the API rule with ids and inlined label names", () => {
    const rule = buildRule(
      resolved,
      desk.automationRules?.[0] as never,
      placeholderRefs(),
    );
    expect(rule).toEqual({
      name: "rule text",
      enabled: true,
      trigger: { type: "status_changed", to: ["column-done"] },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldId: "field-impact",
            op: "equals",
            value: "many text",
          },
        ],
      },
      actions: [
        { type: "add_label", label: "vip text" },
        { type: "notify", roles: ["lead"], message: "Done: {{task.title}}" },
      ],
    });
    const assign = buildRule(
      resolved,
      desk.automationRules?.[1] as never,
      placeholderRefs(),
    );
    expect(assign?.actions).toEqual([
      { type: "set_status", columnId: "column-doing" },
      { type: "assign", userIds: ["user-template-check"] },
    ]);
  });

  it("skips a rule that names a skipped label", () => {
    expect(
      buildRule(
        resolved,
        desk.automationRules?.[0] as never,
        placeholderRefs(new Set(["vip"])),
      ),
    ).toBeNull();
  });
});

describe("planSampleData", () => {
  it("numbers tasks with sub-tasks after their parent and dates from today", () => {
    const plan = planSampleData(resolved, "2026-03-30");
    expect(plan.tasks.map((task) => [task.key, task.number])).toEqual([
      ["a", 1],
      ["a#1", 2],
      ["a#2", 3],
      ["b", 4],
      ["c", 5],
    ]);
    expect(plan.tasks.map((task) => task.position)).toEqual([0, 1, 2, 0, 0]);
    const first = plan.tasks[0];
    expect(first).toMatchObject({
      dueDate: "2026-04-02",
      fieldValues: { impact: "many text" },
      cycleIndex: 0,
      moduleKey: "q1",
      recurrence: {
        frequency: "monthly",
        monthDay: 5,
        anchorDate: "2026-04-02",
        nextRunDate: "2026-04-05",
        trigger: "schedule",
      },
    });
    expect(plan.relations).toEqual([
      { from: "a", to: "a#1", type: "subtask" },
      { from: "a", to: "a#2", type: "subtask" },
      { from: "a", to: "b", type: "blocks" },
      { from: "c", to: "a", type: "related" },
    ]);
    expect(plan.cycles).toEqual([
      { name: "cycle text", startDate: "2026-03-28", endDate: "2026-04-10" },
    ]);
  });

  it("keeps only the first tasks for starters", () => {
    const plan = planSampleData(resolved, "2026-03-30", { maxTasks: 2 });
    expect(plan.tasks.map((task) => task.key)).toEqual(["a", "b"]);
    expect(plan.relations).toEqual([{ from: "a", to: "b", type: "blocks" }]);
  });
});
