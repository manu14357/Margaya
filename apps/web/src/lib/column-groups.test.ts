import { describe, expect, it } from "vitest";
import {
  columnGroupOf,
  getCompletedColumn,
  getEntryColumn,
  isClosedGroup,
  progressPercent,
  sortColumnsByGroup,
  taskGroupOf,
  withoutTriage,
} from "./column-groups";

const columns = [
  { slug: "to-do", position: 0, group: "unstarted", isFinal: false },
  { slug: "in-progress", position: 1, group: "started", isFinal: false },
  { slug: "wont-do", position: 2, group: "cancelled", isFinal: true },
  { slug: "shipped", position: 3, group: "completed", isFinal: true },
];

describe("columnGroupOf", () => {
  it("reads the group, falling back to isFinal for columns without one", () => {
    expect(columnGroupOf(columns[1])).toBe("started");
    expect(columnGroupOf({ slug: "done", isFinal: true })).toBe("completed");
    expect(columnGroupOf({ slug: "x", isFinal: false })).toBe("unstarted");
    expect(columnGroupOf({ slug: "x", group: "bogus" })).toBe("unstarted");
  });
});

describe("taskGroupOf", () => {
  it("resolves a column slug to its group", () => {
    expect(taskGroupOf("shipped", columns)).toBe("completed");
    expect(taskGroupOf("wont-do", columns)).toBe("cancelled");
  });

  it("treats planned as backlog and archived as no group", () => {
    expect(taskGroupOf("planned", columns)).toBe("backlog");
    expect(taskGroupOf("archived", columns)).toBeNull();
  });

  it("treats an unknown slug as not started", () => {
    expect(taskGroupOf("legacy", columns)).toBe("unstarted");
  });
});

describe("getEntryColumn", () => {
  it("prefers the first not-started column by position", () => {
    const shuffled = [
      { slug: "later", position: 5, group: "unstarted" },
      { slug: "doing", position: 0, group: "started" },
      { slug: "first", position: 1, group: "unstarted" },
    ];
    expect(getEntryColumn(shuffled)?.slug).toBe("first");
  });

  it("falls back to the first open column", () => {
    expect(
      getEntryColumn([
        { slug: "done", position: 0, group: "completed" },
        { slug: "doing", position: 1, group: "started" },
      ])?.slug,
    ).toBe("doing");
  });

  it("returns nothing when every column is closed", () => {
    expect(
      getEntryColumn([{ slug: "done", position: 0, group: "completed" }]),
    ).toBeUndefined();
  });
});

describe("getCompletedColumn", () => {
  it("skips a cancelled column that comes first", () => {
    expect(getCompletedColumn(columns)?.slug).toBe("shipped");
  });

  it("returns nothing without a completed column", () => {
    expect(getCompletedColumn(columns.slice(0, 3))).toBeUndefined();
  });
});

describe("progressPercent", () => {
  it("excludes cancelled work from both sides", () => {
    expect(progressPercent({ completed: 2, visible: 5, cancelled: 1 })).toBe(
      50,
    );
  });

  it("handles the edge cases", () => {
    expect(progressPercent({ completed: 0, visible: 0, cancelled: 0 })).toBe(0);
    expect(progressPercent({ completed: 0, visible: 3, cancelled: 3 })).toBe(
      100,
    );
    expect(progressPercent({ completed: 1, visible: 3, cancelled: 0 })).toBe(
      33,
    );
  });
});

describe("helpers", () => {
  it("knows which groups are closed", () => {
    expect(isClosedGroup("completed")).toBe(true);
    expect(isClosedGroup("cancelled")).toBe(true);
    expect(isClosedGroup("started")).toBe(false);
  });

  it("drops triage columns", () => {
    expect(
      withoutTriage([...columns, { slug: "inbox", group: "triage" }]),
    ).toHaveLength(4);
  });

  it("sorts by group rank and keeps board order within a group", () => {
    expect(
      sortColumnsByGroup([
        { slug: "shipped", position: 0, group: "completed" },
        { slug: "review", position: 1, group: "started" },
        { slug: "icebox", position: 2, group: "backlog" },
        { slug: "doing", position: 3, group: "started" },
      ]).map((column) => column.slug),
    ).toEqual(["icebox", "review", "doing", "shipped"]);
  });
});
