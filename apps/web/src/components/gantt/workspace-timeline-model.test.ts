import { describe, expect, it } from "vitest";
import type { MergedTaskQueryResult } from "@/lib/task-query/merge";
import type { FilterNode } from "@/lib/task-query/model";
import {
  barColumns,
  datedOnlyFilter,
  timelineSections,
} from "./workspace-timeline-model";

const DATED = {
  op: "or",
  children: [
    { key: "startDate", operator: "notEmpty" },
    { key: "dueDate", operator: "notEmpty" },
  ],
};

describe("datedOnlyFilter", () => {
  it("asks for tasks with a start or due date", () => {
    expect(datedOnlyFilter(null)).toEqual(DATED);
  });

  it("keeps the view's own filters", () => {
    const root: FilterNode = {
      key: "priority",
      operator: "in",
      values: ["high"],
    };
    expect(datedOnlyFilter(root)).toEqual({
      op: "and",
      children: [DATED, root],
    });
  });

  it("leaves a tree alone when wrapping would pass the API's limits", () => {
    const condition = { key: "priority", operator: "in", values: ["high"] };
    const deep: FilterNode = {
      op: "and",
      children: [
        { op: "or", children: [{ op: "and", children: [condition] }] },
      ],
    };
    expect(datedOnlyFilter(deep)).toBe(deep);

    const crowded: FilterNode = {
      op: "and",
      children: Array.from({ length: 5 }, () => ({
        op: "or" as const,
        children: Array.from({ length: 10 }, () => condition),
      })),
    };
    expect(datedOnlyFilter(crowded)).toBe(crowded);
  });
});

function result(
  groups: { key: string; taskIds: string[]; count?: number; next?: string }[],
  tasks: Record<string, { startDate?: string | null; dueDate?: string | null }>,
) {
  return {
    groups: groups.map((group) => ({
      key: group.key,
      taskIds: group.taskIds,
      count: group.count ?? group.taskIds.length,
      nextCursor: group.next ?? null,
    })),
    tasks: Object.fromEntries(
      Object.entries(tasks).map(([id, dates]) => [
        id,
        { id, title: id, startDate: null, dueDate: null, ...dates },
      ]),
    ),
    meta: {
      projects: [
        { id: "p1", name: "Web", icon: null },
        { id: "p2", name: "API", icon: "Layout" },
      ],
    },
  } as unknown as MergedTaskQueryResult;
}

describe("timelineSections", () => {
  it("makes one section per project, each by start date", () => {
    const sections = timelineSections(
      result(
        [
          { key: "p1", taskIds: ["late", "early"] },
          { key: "p2", taskIds: ["due-only"] },
        ],
        {
          late: { startDate: "2026-03-10", dueDate: "2026-03-12" },
          early: { startDate: "2026-03-01", dueDate: "2026-03-02" },
          "due-only": { dueDate: "2026-03-05" },
        },
      ),
    );
    expect(sections.map((section) => section.name)).toEqual(["Web", "API"]);
    expect(sections[0]?.rows.map((row) => row.id)).toEqual(["early", "late"]);
    const dueOnly = sections[1]?.rows[0];
    expect(dueOnly?.scheduleStart).toEqual(dueOnly?.scheduleEnd);
  });

  it("puts swapped dates right and drops undated rows", () => {
    const [section] = timelineSections(
      result([{ key: "p1", taskIds: ["swapped", "undated"], count: 2 }], {
        swapped: { startDate: "2026-03-10", dueDate: "2026-03-01" },
        undated: {},
      }),
    );
    expect(section?.rows.map((row) => row.id)).toEqual(["swapped"]);
    const row = section?.rows[0];
    expect((row?.scheduleStart as Date) < (row?.scheduleEnd as Date)).toBe(
      true,
    );
  });

  it("leaves out empty projects unless more rows can load", () => {
    const sections = timelineSections(
      result(
        [
          { key: "p1", taskIds: [], count: 0 },
          { key: "p2", taskIds: [], count: 60, next: "cursor" },
        ],
        {},
      ),
    );
    expect(sections.map((section) => section.projectId)).toEqual(["p2"]);
    expect(sections[0]).toMatchObject({ hasMore: true, count: 60 });
  });

  it("skips a group whose project the response doesn't describe", () => {
    expect(
      timelineSections(
        result([{ key: "gone", taskIds: ["a"] }], {
          a: { dueDate: "2026-03-05" },
        }),
      ),
    ).toEqual([]);
  });
});

describe("barColumns", () => {
  const rangeStart = new Date(2026, 2, 1);
  const span = (start: Date, end: Date) => ({
    scheduleStart: start,
    scheduleEnd: end,
  });

  it("spans the bar's days as grid lines", () => {
    expect(
      barColumns(
        span(new Date(2026, 2, 3), new Date(2026, 2, 5)),
        rangeStart,
        10,
      ),
    ).toEqual({ start: 3, end: 6 });
  });

  it("clips a bar to the visible days", () => {
    expect(
      barColumns(
        span(new Date(2026, 1, 20), new Date(2026, 3, 20)),
        rangeStart,
        10,
      ),
    ).toEqual({ start: 1, end: 11 });
  });

  it("is null outside the visible days", () => {
    expect(
      barColumns(
        span(new Date(2026, 1, 1), new Date(2026, 1, 2)),
        rangeStart,
        10,
      ),
    ).toBeNull();
    expect(
      barColumns(
        span(new Date(2026, 3, 1), new Date(2026, 3, 2)),
        rangeStart,
        10,
      ),
    ).toBeNull();
  });
});
