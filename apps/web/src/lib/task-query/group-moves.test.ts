import { describe, expect, it } from "vitest";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import {
  groupsAfterMove,
  isDraggableGrouping,
  planGroupMove,
} from "./group-moves";

const meta = {
  users: [],
  projects: [],
  columns: [],
  labels: [
    { key: "name:Bug", name: "Bug", color: "red", workspaceLabelId: "l-bug" },
    { key: "name:Loose", name: "Loose", color: "gray", workspaceLabelId: null },
    { key: "name:Ui", name: "Ui", color: "blue", workspaceLabelId: "l-ui" },
  ],
  cycles: [],
  modules: [],
  estimatePoints: [],
  customFields: [],
} as TaskQueryMeta;

describe("board moves between groups", () => {
  it("drags only by properties a drop can change", () => {
    expect(isDraggableGrouping("priority", false)).toBe(true);
    expect(isDraggableGrouping("status", true)).toBe(true);
    expect(isDraggableGrouping("status", false)).toBe(false);
    for (const key of ["group", "project", "createdBy", "estimate"] as const) {
      expect(isDraggableGrouping(key, true)).toBe(false);
    }
    expect(isDraggableGrouping(null, true)).toBe(false);
  });

  it("changes the grouped property", () => {
    expect(planGroupMove("priority", "low", "high", meta)).toEqual({
      kind: "priority",
      priority: "high",
    });
    expect(planGroupMove("status", "to-do", "done", meta)).toEqual({
      kind: "status",
      status: "done",
    });
    expect(planGroupMove("cycle", "c1", "none", meta)).toEqual({
      kind: "cycle",
      cycleId: null,
    });
    expect(planGroupMove("priority", "low", "low", meta)).toBe(null);
  });

  it("moves an assignee: removes the source user, adds the target", () => {
    expect(planGroupMove("assignee", "u1", "u2", meta)).toEqual({
      kind: "assignee",
      remove: "u1",
      add: "u2",
    });
    expect(planGroupMove("assignee", "none", "u2", meta)).toEqual({
      kind: "assignee",
      remove: null,
      add: "u2",
    });
    // Dropping on "No assignee" clears them.
    expect(planGroupMove("assignee", "u1", "none", meta)).toEqual({
      kind: "assignee",
      remove: "u1",
      add: null,
    });
  });

  it("moves labels by their workspace label, never without one", () => {
    expect(planGroupMove("label", "name:Bug", "name:Ui", meta)).toEqual({
      kind: "label",
      removeLabelId: "l-bug",
      addLabelId: "l-ui",
    });
    expect(planGroupMove("label", "name:Loose", "name:Ui", meta)).toBe(null);
    expect(planGroupMove("module", "m1", "m2", meta)).toEqual({
      kind: "module",
      remove: "m1",
      add: "m2",
    });
  });

  it("puts a task under each assignee after a move", () => {
    const row = { assigneeIds: ["u1", "u3"] } as TaskQueryRow;
    expect(groupsAfterMove("assignee", row, ["u1", "u3"], "u1", "u2")).toEqual([
      "u3",
      "u2",
    ]);
    expect(
      groupsAfterMove("assignee", row, ["u1", "u3"], "u1", "none"),
    ).toEqual(["none"]);
    expect(
      groupsAfterMove("label", row, ["name:Bug"], "name:Bug", "none"),
    ).toEqual(["none"]);
    expect(groupsAfterMove("priority", row, ["low"], "low", "high")).toEqual([
      "high",
    ]);
  });
});
