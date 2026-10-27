import { describe, expect, it } from "vitest";
import type { AnalyticsReportConfig } from "@/types/analytics-report";
import { type BuilderAvailability, defaultBuilderState } from "./builder-state";
import {
  builderStateOfReport,
  canonicalReportConfig,
  isSameReportConfig,
  planReportScope,
  reportConfigOf,
  reportNotes,
} from "./report-config";

const everything: BuilderAvailability = {
  dimensions: ["group", "priority", "assignee", "label", "cycle", "createdAt"],
  pointsAvailable: true,
};

const filters = { key: "priority", operator: "in", values: ["high"] };

describe("reportConfigOf", () => {
  it("stores the task set and the builder settings", () => {
    const config = reportConfigOf(
      {
        scope: { projectIds: ["p2", "p1", "p2"] },
        filters: filters as AnalyticsReportConfig["filters"],
        archived: "include",
      },
      { ...defaultBuilderState("assignee"), segment: "label" },
    );
    expect(config).toEqual({
      scope: { projectIds: ["p1", "p2"] },
      filters,
      archived: "include",
      showSubTasks: true,
      xAxis: "assignee",
      segment: "label",
      metric: "taskCount",
      includeNone: true,
      sortByValue: true,
    });
  });

  it("leaves out an empty scope and keeps the date bucket only for dates", () => {
    const config = reportConfigOf(
      { scope: { projectIds: [] }, filters: null },
      { ...defaultBuilderState("createdAt"), dateBucket: "week" },
    );
    expect(config.scope).toBeUndefined();
    expect(config.archived).toBe("exclude");
    expect(config.dateBucket).toBe("week");
    expect(
      reportConfigOf({}, defaultBuilderState("priority")).dateBucket,
    ).toBeUndefined();
  });
});

describe("isSameReportConfig", () => {
  it("treats omitted fields as their defaults", () => {
    const saved: AnalyticsReportConfig = { xAxis: "priority" };
    const current = reportConfigOf({}, defaultBuilderState("priority"));
    expect(isSameReportConfig(saved, current)).toBe(true);
    expect(canonicalReportConfig(saved)).toEqual(current);
  });

  it("notices a changed filter, scope or builder setting", () => {
    const saved = reportConfigOf({}, defaultBuilderState("priority"));
    expect(
      isSameReportConfig(saved, {
        ...saved,
        filters: filters as AnalyticsReportConfig["filters"],
      }),
    ).toBe(false);
    expect(
      isSameReportConfig(saved, { ...saved, scope: { projectIds: ["p1"] } }),
    ).toBe(false);
    expect(isSameReportConfig(saved, { ...saved, segment: "group" })).toBe(
      false,
    );
  });
});

describe("builderStateOfReport", () => {
  it("applies the saved settings when the scope offers them", () => {
    const { state, reset } = builderStateOfReport(
      {
        xAxis: "createdAt",
        segment: "group",
        metric: "estimatePoints",
        dateBucket: "week",
        includeNone: false,
        showSubTasks: false,
      },
      everything,
    );
    expect(reset).toBe(false);
    expect(state).toEqual({
      xAxis: "createdAt",
      segment: "group",
      metric: "estimatePoints",
      dateBucket: "week",
      includeNone: false,
      sortByValue: false,
      showSubTasks: false,
    });
  });

  it("reports settings the scope doesn't offer", () => {
    const { state, reset } = builderStateOfReport(
      { xAxis: "status", metric: "estimatePoints" },
      { dimensions: ["priority", "group"], pointsAvailable: false },
    );
    expect(reset).toBe(true);
    expect(state.xAxis).toBe("priority");
    expect(state.metric).toBe("taskCount");
  });
});

describe("planReportScope", () => {
  const selectableIds = ["p1", "p2", "p3"];

  it("selects the saved projects in workspace analytics", () => {
    const plan = planReportScope(
      { xAxis: "priority", scope: { projectIds: ["p2", "p1"] } },
      { kind: "workspace", selectableIds },
    );
    expect(plan).toMatchObject({
      projectIds: ["p2", "p1"],
      scopeKey: "p1,p2",
      leftOutCount: 0,
      allProjects: false,
    });
  });

  it("leaves out projects that can't be selected", () => {
    const plan = planReportScope(
      { xAxis: "priority", scope: { projectIds: ["p1", "archived"] } },
      { kind: "workspace", selectableIds },
    );
    expect(plan.projectIds).toEqual(["p1"]);
    expect(plan.leftOutCount).toBe(1);
    expect(plan.allProjects).toBe(false);
  });

  it("falls back to all projects when none remain", () => {
    expect(
      planReportScope(
        { xAxis: "priority", scope: { projectIds: ["archived"] } },
        { kind: "workspace", selectableIds },
      ),
    ).toMatchObject({ projectIds: [], scopeKey: "all", allProjects: true });
    expect(
      planReportScope(
        { xAxis: "priority" },
        { kind: "workspace", selectableIds, droppedCount: 2 },
      ).allProjects,
    ).toBe(true);
    expect(
      planReportScope(
        { xAxis: "priority" },
        { kind: "workspace", selectableIds },
      ).allProjects,
    ).toBe(false);
  });

  it("keeps the page's project in project analytics", () => {
    const same = planReportScope(
      { xAxis: "priority", scope: { projectIds: ["p1"] } },
      { kind: "project", projectId: "p1", selectableIds: [] },
    );
    expect(same).toMatchObject({ scopeKey: "p1", otherProjects: false });
    const other = planReportScope(
      { xAxis: "priority", scope: { projectIds: ["p1", "p2"] } },
      { kind: "project", projectId: "p1", selectableIds: [] },
    );
    expect(other).toMatchObject({ scopeKey: "p1", otherProjects: true });
  });
});

describe("reportNotes", () => {
  it("lists everything that wasn't applied", () => {
    const plan = planReportScope(
      { xAxis: "priority", scope: { projectIds: ["gone"] } },
      { kind: "workspace", selectableIds: ["p1"] },
    );
    expect(reportNotes(plan, { droppedCount: 1, builderReset: true })).toEqual([
      { kind: "dropped", count: 1 },
      { kind: "leftOut", count: 1 },
      { kind: "allProjects" },
      { kind: "builderReset" },
    ]);
    expect(
      reportNotes(
        planReportScope(
          { xAxis: "priority" },
          {
            kind: "workspace",
            selectableIds: ["p1"],
          },
        ),
      ),
    ).toEqual([]);
  });
});
