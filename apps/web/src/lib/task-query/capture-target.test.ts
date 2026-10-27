import { describe, expect, it } from "vitest";
import type { TaskQueryMeta } from "@/types/task-query";
import { type CaptureCapabilities, captureTargetFor } from "./capture-target";

const ALL: CaptureCapabilities = {
  updateCycles: true,
  updateModules: true,
  updateTasks: true,
};

function column(
  projectId: string,
  slug: string,
  group: TaskQueryMeta["columns"][number]["group"],
  position: number,
) {
  return {
    projectId,
    slug,
    name: slug.toUpperCase(),
    icon: null,
    group,
    position,
    isFinal: group === "completed",
  };
}

const meta: TaskQueryMeta = {
  users: [{ id: "u1", name: "Ana", image: null }],
  projects: [],
  columns: [
    column("p1", "triage", "triage", 0),
    column("p1", "backlog", "backlog", 1),
    column("p1", "to-do", "unstarted", 2),
    column("p1", "doing", "started", 3),
    column("p1", "done", "completed", 4),
    column("p2", "open", "unstarted", 0),
  ],
  labels: [
    { key: "name:bug", name: "Bug", color: "red", workspaceLabelId: "l1" },
  ],
  cycles: [{ id: "c1", projectId: "p1", name: "C1", status: "current" }],
  modules: [{ id: "m1", projectId: "p2", name: "M1", status: "planned" }],
  estimatePoints: [
    { id: "e1", projectId: "p1", value: "3", position: 0, type: "points" },
  ],
  customFields: [],
} as TaskQueryMeta;

describe("captureTargetFor", () => {
  it("uses the project's entry column when the group has no status", () => {
    expect(
      captureTargetFor({
        groupings: [{ by: "priority", key: "high" }],
        meta,
        scopeProjectId: "p1",
        can: ALL,
      }),
    ).toEqual({
      projectId: "p1",
      status: "to-do",
      statusName: "TO-DO",
      priority: "high",
    });
  });

  it("takes the group's status and sub-group's assignee", () => {
    expect(
      captureTargetFor({
        groupings: [
          { by: "status", key: "doing" },
          { by: "assignee", key: "u1" },
        ],
        meta,
        scopeProjectId: "p1",
        can: ALL,
      }),
    ).toMatchObject({ status: "doing", assigneeIds: ["u1"] });
  });

  it("keeps No assignee unassigned and No priority as no-priority", () => {
    expect(
      captureTargetFor({
        groupings: [
          { by: "assignee", key: "none" },
          { by: "priority", key: "none" },
        ],
        meta,
        scopeProjectId: "p1",
        can: ALL,
      }),
    ).toMatchObject({ assigneeIds: [], priority: "no-priority" });
  });

  it("maps a column group to its first column", () => {
    expect(
      captureTargetFor({
        groupings: [{ by: "group", key: "completed" }],
        meta,
        scopeProjectId: "p1",
        can: ALL,
      }),
    ).toMatchObject({ status: "done" });
  });

  it("offers no add in triage or creator groups", () => {
    for (const grouping of [
      { by: "status" as const, key: "triage" },
      { by: "group" as const, key: "triage" },
      { by: "createdBy" as const, key: "u1" },
    ]) {
      expect(
        captureTargetFor({
          groupings: [grouping],
          meta,
          scopeProjectId: "p1",
          can: ALL,
        }),
      ).toBeNull();
    }
  });

  it("adds the group's label, cycle and estimate", () => {
    expect(
      captureTargetFor({
        groupings: [
          { by: "label", key: "name:bug" },
          { by: "cycle", key: "c1" },
        ],
        meta,
        scopeProjectId: "p1",
        can: ALL,
      }),
    ).toMatchObject({
      labels: [{ name: "Bug", color: "red" }],
      cycleId: "c1",
    });
    expect(
      captureTargetFor({
        groupings: [{ by: "estimate", key: "e1" }],
        meta,
        scopeProjectId: "p1",
        can: ALL,
      }),
    ).toMatchObject({ estimatePointId: "e1" });
  });

  it("needs cycle:update and module:update for those groups", () => {
    const can = {
      updateCycles: false,
      updateModules: false,
      updateTasks: true,
    };
    expect(
      captureTargetFor({
        groupings: [{ by: "cycle", key: "c1" }],
        meta,
        scopeProjectId: "p1",
        can,
      }),
    ).toBeNull();
    // "No cycle" needs nothing.
    expect(
      captureTargetFor({
        groupings: [{ by: "cycle", key: "none" }],
        meta,
        scopeProjectId: "p1",
        can,
      }),
    ).toMatchObject({ status: "to-do" });
  });

  it("on cross-project lists adds only in groups of one project", () => {
    const cross = { meta, scopeProjectId: null, can: ALL };
    expect(
      captureTargetFor({
        ...cross,
        groupings: [{ by: "priority", key: "high" }],
      }),
    ).toBeNull();
    expect(
      captureTargetFor({
        ...cross,
        groupings: [{ by: "project", key: "p2" }],
      }),
    ).toMatchObject({ projectId: "p2", status: "open" });
    expect(
      captureTargetFor({
        ...cross,
        groupings: [{ by: "module", key: "m1" }],
      }),
    ).toMatchObject({ projectId: "p2", moduleId: "m1" });
    // A cycle of p1 inside the p2 group can't hold one task.
    expect(
      captureTargetFor({
        ...cross,
        groupings: [
          { by: "project", key: "p2" },
          { by: "cycle", key: "c1" },
        ],
      }),
    ).toBeNull();
  });
});
