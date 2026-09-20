import { describe, expect, it } from "vitest";
import {
  chunk,
  isArchiveTab,
  resolveArchiveTab,
  visibleArchiveTabs,
  withoutTaskIds,
} from "./archives";

describe("visibleArchiveTabs", () => {
  it("shows Tasks only until the summary loads", () => {
    expect(visibleArchiveTabs(undefined, "workspace")).toEqual(["tasks"]);
  });

  it("hides null counts, and projects inside a project", () => {
    const summary = { tasks: 1, cycles: null, modules: 0, projects: 2 };
    expect(visibleArchiveTabs(summary, "workspace")).toEqual([
      "tasks",
      "modules",
      "projects",
    ]);
    expect(visibleArchiveTabs(summary, "project")).toEqual([
      "tasks",
      "modules",
    ]);
  });
});

describe("resolveArchiveTab", () => {
  it("falls back to Tasks for a hidden or unknown tab", () => {
    expect(resolveArchiveTab("cycles", ["tasks", "cycles"])).toBe("cycles");
    expect(resolveArchiveTab("cycles", ["tasks"])).toBe("tasks");
    expect(isArchiveTab("cycles")).toBe(true);
    expect(isArchiveTab("pages")).toBe(false);
  });
});

describe("chunk", () => {
  it("splits ids into requests of at most the size", () => {
    const ids = Array.from({ length: 450 }, (_, index) => `t${index}`);
    expect(chunk(ids, 200).map((part) => part.length)).toEqual([200, 200, 50]);
    expect(chunk([], 200)).toEqual([]);
  });
});

describe("withoutTaskIds", () => {
  const data = {
    totalCount: 3,
    tasks: { a: {}, b: {}, c: {} },
    groups: [
      { key: "x", taskIds: ["a", "b"], count: 2 },
      {
        key: "y",
        taskIds: ["c"],
        count: 1,
        subGroups: [{ key: "z", taskIds: ["c"], count: 1 }],
      },
    ],
  };

  it("drops the ids from groups, sub-groups and the total", () => {
    const result = withoutTaskIds(data, new Set(["b", "c"]));
    expect(result.totalCount).toBe(1);
    expect(result.groups[0]).toMatchObject({ taskIds: ["a"], count: 1 });
    expect(result.groups[1]).toMatchObject({ taskIds: [], count: 0 });
    expect(result.groups[1]?.subGroups?.[0]).toMatchObject({
      taskIds: [],
      count: 0,
    });
  });

  it("returns the same data when nothing is hidden", () => {
    expect(withoutTaskIds(data, new Set())).toBe(data);
    expect(withoutTaskIds(data, new Set(["unknown"]))).toBe(data);
  });
});
