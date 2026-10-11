import { describe, expect, it } from "vitest";
import { normalizeTaskQuery } from "../../../apps/api/src/task-query/run";
import {
  filterNodeSchema,
  taskQueryRequestSchema,
} from "../../../apps/api/src/task-query/schema";

describe("taskQueryRequestSchema", () => {
  it("accepts a full request", () => {
    const parsed = taskQueryRequestSchema.safeParse({
      workspaceId: "workspace-1",
      scope: { projectIds: ["project-1"] },
      filters: {
        op: "and",
        children: [
          { key: "priority", operator: "in", values: ["high"] },
          {
            op: "or",
            children: [
              {
                key: "dueDate",
                operator: "withinNext",
                amount: 7,
                unit: "days",
              },
              { key: "dueDate", operator: "empty" },
            ],
          },
        ],
      },
      archived: "include",
      search: "login",
      display: {
        groupBy: "priority",
        subGroupBy: "assignee",
        orderBy: { field: "dueDate", direction: "asc" },
        showSubTasks: false,
        showEmptyGroups: true,
      },
      include: ["labels", "assignees"],
      page: { limit: 100 },
      mode: "rows",
      context: { timeZone: "Asia/Kolkata", weekStartsOn: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses unknown fields in conditions and the request", () => {
    expect(
      filterNodeSchema.safeParse({
        key: "priority",
        operator: "in",
        values: ["high"],
        colour: "red",
      }).success,
    ).toBe(false);
    expect(
      taskQueryRequestSchema.safeParse({ workspaceId: "w", sort: "x" }).success,
    ).toBe(false);
  });

  it("refuses unknown includes, orders, modes and week starts", () => {
    const base = { workspaceId: "w" };
    for (const request of [
      { ...base, include: ["comments"] },
      { ...base, display: { orderBy: { field: "colour" } } },
      { ...base, mode: "rows-and-ids" },
      { ...base, context: { weekStartsOn: 3 } },
      { ...base, page: { limit: 201 } },
      { ...base, scope: { projectIds: [] } },
    ]) {
      expect(taskQueryRequestSchema.safeParse(request).success).toBe(false);
    }
  });
});

describe("normalizeTaskQuery", () => {
  it("applies the defaults", () => {
    expect(normalizeTaskQuery({ workspaceId: "w" })).toMatchObject({
      projectIds: null,
      filters: null,
      archived: "exclude",
      search: null,
      groupBy: null,
      subGroupBy: null,
      order: { field: "createdAt", direction: "desc" },
      showSubTasks: true,
      showEmptyGroups: false,
      include: [],
      mode: "rows",
      timeZone: "UTC",
      weekStartsOn: 0,
    });
  });

  it("ignores grouping in ids mode", () => {
    expect(
      normalizeTaskQuery({
        workspaceId: "w",
        mode: "ids",
        display: { groupBy: "priority", subGroupBy: "priority" },
      }),
    ).toMatchObject({ groupBy: null, subGroupBy: null });
  });

  it("refuses a sub-group without a different group", () => {
    for (const display of [
      { subGroupBy: "priority" as const },
      { groupBy: "priority" as const, subGroupBy: "priority" as const },
    ]) {
      expect(() => normalizeTaskQuery({ workspaceId: "w", display })).toThrow(
        "Group and sub-group must differ",
      );
    }
  });

  it("sorts includes so equal requests hash equally", () => {
    expect(
      normalizeTaskQuery({
        workspaceId: "w",
        include: ["modules", "labels", "modules"],
      }).include,
    ).toEqual(["labels", "modules"]);
  });
});
