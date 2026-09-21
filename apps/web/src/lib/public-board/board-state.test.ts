import { describe, expect, it } from "vitest";
import type { PublicTaskPage, PublicTaskRow } from "@/types/public-board";
import {
  applyPublicReaction,
  applyVote,
  mergeTaskPages,
  remainingInGroup,
} from "./board-state";

function row(id: string): PublicTaskRow {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    key: `WEB-${id}`,
    title: `Task ${id}`,
    status: "to-do",
    priority: "no-priority",
    dueDate: null,
    startDate: null,
    labels: [],
    counts: {},
  };
}

function page(
  groups: Array<{
    key: string;
    count: number;
    ids: string[];
    next: string | null;
  }>,
): PublicTaskPage {
  return {
    groups: groups.map((group) => ({
      key: group.key,
      count: group.count,
      taskIds: group.ids,
      nextCursor: group.next,
    })),
    tasks: Object.fromEntries(
      groups.flatMap((group) => group.ids.map((id) => [id, row(id)])),
    ),
    totalCount: groups.reduce((sum, group) => sum + group.count, 0),
  };
}

describe("mergeTaskPages", () => {
  it("appends a column's next page without duplicates", () => {
    const base = page([
      { key: "to-do", count: 4, ids: ["t1", "t2"], next: "c1" },
      { key: "done", count: 1, ids: ["t9"], next: null },
    ]);
    const more = page([
      { key: "to-do", count: 4, ids: ["t2", "t3", "t4"], next: null },
    ]);
    const merged = mergeTaskPages(base, [{ group: "to-do", page: more }]);
    expect(merged.groups[0]?.taskIds).toEqual(["t1", "t2", "t3", "t4"]);
    expect(merged.groups[0]?.nextCursor).toBeNull();
    expect(merged.groups[1]?.taskIds).toEqual(["t9"]);
    expect(Object.keys(merged.tasks).sort()).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t9",
    ]);
    // The base page is left untouched.
    expect(base.groups[0]?.taskIds).toEqual(["t1", "t2"]);
  });

  it("ignores slices for unknown columns", () => {
    const base = page([{ key: "to-do", count: 1, ids: ["t1"], next: null }]);
    const merged = mergeTaskPages(base, [
      {
        group: "gone",
        page: page([{ key: "gone", count: 1, ids: ["t5"], next: null }]),
      },
    ]);
    expect(merged.groups).toEqual(base.groups);
    expect(merged.tasks.t5).toBeUndefined();
  });

  it("counts what is left to load", () => {
    const base = page([
      { key: "to-do", count: 75, ids: ["t1", "t2"], next: "c" },
    ]);
    const group = base.groups[0];
    expect(group && remainingInGroup(group)).toBe(73);
  });
});

describe("applyVote", () => {
  it("adds, switches and removes my vote", () => {
    const up = applyVote({ up: 2, down: 1, mine: null }, 1);
    expect(up).toEqual({ next: { up: 3, down: 1, mine: 1 }, value: 1 });

    const switched = applyVote(up.next, -1);
    expect(switched).toEqual({ next: { up: 2, down: 2, mine: -1 }, value: -1 });

    const removed = applyVote(switched.next, -1);
    expect(removed).toEqual({
      next: { up: 2, down: 1, mine: null },
      value: null,
    });
  });

  it("never goes below zero", () => {
    expect(applyVote({ up: 0, down: 0, mine: 1 }, 1).next).toEqual({
      up: 0,
      down: 0,
      mine: null,
    });
  });
});

describe("applyPublicReaction", () => {
  it("adds a new group, increments, and removes my reaction", () => {
    const added = applyPublicReaction([], "heart");
    expect(added).toEqual([{ emoji: "heart", count: 1, reacted: true }]);
    expect(applyPublicReaction(added, "heart")).toEqual([]);
    expect(
      applyPublicReaction(
        [{ emoji: "eyes", count: 2, reacted: false }],
        "eyes",
      ),
    ).toEqual([{ emoji: "eyes", count: 3, reacted: true }]);
    expect(
      applyPublicReaction([{ emoji: "eyes", count: 2, reacted: true }], "eyes"),
    ).toEqual([{ emoji: "eyes", count: 1, reacted: false }]);
  });
});
