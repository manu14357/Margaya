import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  boardTaskList,
  groupRelations,
  matchesTaskQuery,
  oldestParent,
  parentCandidates,
  RELATION_DISPLAY_KEYS,
  type RelationRow,
  relationCandidates,
  relationPerspective,
  subtaskCandidates,
} from "./task-relations";

type Summary = { id: string; title: string };

function row(
  id: string,
  sourceTaskId: string,
  targetTaskId: string,
  relationType: string,
  createdAt = "2026-09-01T00:00:00.000Z",
): RelationRow<Summary> {
  return {
    id,
    sourceTaskId,
    targetTaskId,
    relationType,
    createdAt,
    sourceTask: { id: sourceTaskId, title: sourceTaskId },
    targetTask: { id: targetTaskId, title: targetTaskId },
  };
}

const tasks = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("relationPerspective", () => {
  it.each([
    ["blocks", true, "blocking"],
    ["blocks", false, "blocked_by"],
    ["start_before", true, "start_before"],
    ["start_before", false, "start_after"],
    ["finish_before", true, "finish_before"],
    ["finish_before", false, "finish_after"],
    ["related", true, "related"],
    ["related", false, "related"],
    ["duplicate", true, "duplicate"],
    ["duplicate", false, "duplicate"],
    ["subtask", true, "subtask"],
    ["subtask", false, "subtask"],
  ] as const)("reads %s from the %s side as %s", (type, isSource, key) => {
    expect(relationPerspective(type, isSource)).toBe(key);
  });
});

describe("groupRelations", () => {
  it("groups by this task's point of view in the fixed order", () => {
    const relations = [
      row("r1", "a", "b", "related"),
      row("r2", "c", "a", "blocks"),
      row("r3", "a", "d", "blocks"),
      row("r4", "e", "a", "finish_before"),
      row("r5", "a", "e", "subtask"),
    ];
    const groups = groupRelations(relations, "a");
    expect(groups.map((group) => group.key)).toEqual([
      "blocked_by",
      "blocking",
      "related",
      "finish_after",
    ]);
    expect(groups[0].items[0].task.id).toBe("c");
    expect(groups[1].items[0].task.id).toBe("d");
    // The other side reads the same row inversely.
    expect(groupRelations(relations, "c")[0].key).toBe("blocking");
  });

  it("skips rows whose other task is not visible", () => {
    const hidden = { ...row("r1", "a", "b", "related"), targetTask: null };
    expect(groupRelations([hidden], "a")).toEqual([]);
  });

  it("covers every display key", () => {
    expect(RELATION_DISPLAY_KEYS).toHaveLength(8);
  });
});

describe("relationCandidates", () => {
  it("excludes the task and tasks already related in either direction", () => {
    const relations = [
      row("r1", "a", "b", "related"),
      row("r2", "c", "a", "blocks"),
      // A parent row does not count as a relation.
      row("r3", "a", "d", "subtask"),
    ];
    expect(
      relationCandidates(tasks, relations, "a").map((task) => task.id),
    ).toEqual(["d", "e"]);
  });
});

describe("parents", () => {
  it("excludes the task, its current parent and its direct sub-tasks", () => {
    const relations = [
      row("r1", "b", "a", "subtask"),
      row("r2", "a", "c", "subtask"),
      row("r3", "a", "d", "related"),
    ];
    expect(
      parentCandidates(tasks, relations, "a").map((task) => task.id),
    ).toEqual(["d", "e"]);
  });

  it("shows the oldest of several legacy parents", () => {
    const relations = [
      row("r2", "c", "a", "subtask", "2026-09-02T00:00:00.000Z"),
      row("r1", "b", "a", "subtask", "2026-09-01T00:00:00.000Z"),
      row("r3", "a", "d", "subtask", "2026-08-01T00:00:00.000Z"),
    ];
    expect(oldestParent(relations, "a")?.sourceTaskId).toBe("b");
    expect(oldestParent([], "a")).toBeNull();
  });
});

describe("ancestors and existing sub-tasks", () => {
  it("walks cached parents and stops at loops or unknown tasks", () => {
    const cache: Record<string, RelationRow<Summary>[]> = {
      a: [row("r1", "b", "a", "subtask")],
      b: [row("r1", "b", "a", "subtask"), row("r2", "c", "b", "subtask")],
      c: [row("r2", "c", "b", "subtask"), row("r3", "a", "c", "subtask")],
    };
    expect([...ancestorIds("a", (id) => cache[id])].sort()).toEqual(["b", "c"]);
    expect([...ancestorIds("e", (id) => cache[id])]).toEqual([]);
  });

  it("offers neither the task, its sub-tasks nor its ancestors", () => {
    const relations = [row("r1", "a", "b", "subtask")];
    expect(
      subtaskCandidates(tasks, relations, "a", new Set(["c"])).map(
        (task) => task.id,
      ),
    ).toEqual(["d", "e"]);
  });
});

describe("boardTaskList", () => {
  it("lists columns by position, then planned tasks, each by number", () => {
    const board = {
      columns: [
        { position: 2, tasks: [{ id: "x", number: 9 }] },
        {
          position: 1,
          tasks: [
            { id: "y", number: 4 },
            { id: "z", number: 2 },
          ],
        },
      ],
      plannedTasks: [
        { id: "p2", number: 7 },
        { id: "p1", number: 1 },
      ],
    };
    expect(boardTaskList(board).map((task) => task.id)).toEqual([
      "z",
      "y",
      "x",
      "p1",
      "p2",
    ]);
    expect(boardTaskList(undefined)).toEqual([]);
  });
});

describe("matchesTaskQuery", () => {
  it("matches the key or the title without case", () => {
    expect(matchesTaskQuery("web-1", "WEB-12", "Login")).toBe(true);
    expect(matchesTaskQuery("LOG", "WEB-12", "Login")).toBe(true);
    expect(matchesTaskQuery("  ", "WEB-12", "Login")).toBe(true);
    expect(matchesTaskQuery("signup", "WEB-12", "Login")).toBe(false);
  });
});
