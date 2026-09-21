import { describe, expect, it } from "vitest";
import { builtInViews, isBuiltInViewKey } from "./built-in-views";
import { defaultDisplay } from "./display";
import { myWorkBaseConditions, presetFilters } from "./my-work";
import { buildIdsRequest, buildRowsRequest, withoutPage } from "./request";

const state = {
  filters: {
    op: "and" as const,
    children: [{ key: "priority", operator: "in", values: ["high"] }],
  },
  archived: "exclude" as const,
  display: defaultDisplay("project"),
};

describe("task query requests", () => {
  it("builds a grouped rows request for a project", () => {
    const request = buildRowsRequest({
      workspaceId: "w1",
      scope: { kind: "project", projectId: "p1" },
      state,
      baseConditions: [{ key: "cycle", operator: "in", values: ["c1"] }],
      search: "  login ",
      weekStartsOn: 1,
      limit: 50,
    });
    expect(request).toMatchObject({
      workspaceId: "w1",
      scope: { projectIds: ["p1"] },
      archived: "exclude",
      search: "login",
      display: { groupBy: "status", subGroupBy: null },
      page: { limit: 50 },
      mode: "rows",
      context: { weekStartsOn: 1 },
    });
    expect(request.filters).toEqual({
      op: "and",
      children: [
        { key: "cycle", operator: "in", values: ["c1"] },
        state.filters,
      ],
    });
    expect(withoutPage(request)).not.toHaveProperty("page");
  });

  it("lists everything ungrouped for the spreadsheet", () => {
    const request = buildRowsRequest({
      workspaceId: "w1",
      scope: { kind: "workspace" },
      state,
      weekStartsOn: 0,
      limit: 100,
      ungrouped: true,
    });
    expect(request).not.toHaveProperty("scope");
    expect(request.display).toMatchObject({
      groupBy: null,
      subGroupBy: null,
      showEmptyGroups: false,
    });
  });

  it("asks for ids with the filters and sub-task rule only", () => {
    const request = buildIdsRequest({
      workspaceId: "w1",
      scope: { kind: "project", projectId: "p1" },
      state: { ...state, display: { ...state.display, showSubTasks: false } },
      weekStartsOn: 0,
    });
    expect(request).toMatchObject({
      mode: "ids",
      display: { showSubTasks: false },
    });
    expect(request.display).not.toHaveProperty("groupBy");
  });

  it("scopes Your work tabs to me and presets tile filters", () => {
    expect(myWorkBaseConditions("assigned")).toEqual([
      { key: "assignee", operator: "in", values: ["me"] },
    ]);
    expect(myWorkBaseConditions("subscribed")[0]?.key).toBe("subscriber");
    expect(presetFilters("overdue")).toMatchObject({ op: "and" });
    expect(presetFilters("project:p1")).toMatchObject({
      children: [{ key: "group" }, { key: "project", values: ["p1"] }],
    });
    expect(presetFilters("group:started")).toEqual({
      op: "and",
      children: [{ key: "group", operator: "in", values: ["started"] }],
    });
    expect(presetFilters("group:triage")).toBe(null);
    expect(presetFilters("bogus")).toBe(null);
  });

  it("offers the built-in views", () => {
    expect(builtInViews().map((view) => view.key)).toEqual([
      "all",
      "assigned",
      "created",
      "subscribed",
    ]);
    expect(isBuiltInViewKey("assigned")).toBe(true);
    expect(isBuiltInViewKey("some-view-id")).toBe(false);
  });
});
