import { describe, expect, it } from "vitest";
import type { TaskQueryResult } from "@/types/task-query";
import { mergeTaskQueryPages, nextCursorOf } from "./merge";

const emptyMeta: TaskQueryResult["meta"] = {
  users: [],
  projects: [],
  columns: [],
  labels: [],
  cycles: [],
  modules: [],
  estimatePoints: [],
  customFields: [],
};

function row(id: string) {
  return { id, title: id } as unknown as TaskQueryResult["tasks"][string];
}

function page(
  groups: TaskQueryResult["groups"],
  ids: string[],
  meta: Partial<TaskQueryResult["meta"]> = {},
): TaskQueryResult {
  return {
    mode: "rows",
    groupBy: "priority",
    subGroupBy: null,
    today: "2026-09-26",
    totalCount: ids.length,
    groups,
    hasMoreGroups: false,
    tasks: Object.fromEntries(ids.map((id) => [id, row(id)])),
    meta: { ...emptyMeta, ...meta },
  };
}

describe("merging task query pages", () => {
  it("appends a group's next slice without repeating rows", () => {
    const base = page(
      [
        { key: "high", count: 3, taskIds: ["a", "b"], nextCursor: "c1" },
        { key: "low", count: 1, taskIds: ["z"], nextCursor: null },
      ],
      ["a", "b", "z"],
      { users: [{ id: "u1", name: "Ann", image: null }] },
    );
    const more = page(
      [{ key: "high", count: 3, taskIds: ["b", "c"], nextCursor: null }],
      ["b", "c"],
      { users: [{ id: "u2", name: "Bo", image: null }] },
    );
    const merged = mergeTaskQueryPages(base, [{ group: "high", result: more }]);
    expect(merged.groups[0]?.taskIds).toEqual(["a", "b", "c"]);
    expect(merged.groups[0]?.nextCursor).toBe(null);
    expect(merged.groups[1]?.taskIds).toEqual(["z"]);
    expect(Object.keys(merged.tasks).sort()).toEqual(["a", "b", "c", "z"]);
    expect(merged.meta.users.map((user) => user.id)).toEqual(["u1", "u2"]);
    expect(nextCursorOf(merged, "high")).toBe(null);
    expect(nextCursorOf(merged, "missing")).toBe(null);
  });

  it("appends a sub-group cell's slice", () => {
    const base = page(
      [
        {
          key: "high",
          count: 3,
          taskIds: [],
          nextCursor: null,
          subGroups: [
            { key: "u1", count: 3, taskIds: ["a"], nextCursor: "c1" },
          ],
        },
      ],
      ["a"],
    );
    const more = page(
      [
        {
          key: "high",
          count: 3,
          taskIds: [],
          nextCursor: null,
          subGroups: [
            { key: "u1", count: 3, taskIds: ["b", "c"], nextCursor: null },
          ],
        },
      ],
      ["b", "c"],
    );
    const merged = mergeTaskQueryPages(base, [
      { group: "high", subGroup: "u1", result: more },
    ]);
    expect(merged.groups[0]?.subGroups?.[0]?.taskIds).toEqual(["a", "b", "c"]);
    expect(nextCursorOf(merged, "high", "u1")).toBe(null);
    // The base result is not mutated.
    expect(base.groups[0]?.subGroups?.[0]?.taskIds).toEqual(["a"]);
  });
});
