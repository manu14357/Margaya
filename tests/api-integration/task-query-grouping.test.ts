import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { shiftDate, todayUtc } from "../../apps/api/src/utils/calendar-date";
import { resetTestDatabase } from "./helpers/database";
import {
  countsByGroup,
  idsByGroup,
  queryScene,
  sorted,
} from "./helpers/task-query";

/**
 * t1 to-do high [Ben, Olivia] {Bug, UI} by Olivia
 * t2 in-progress urgent [Ben] {UI} by Ben
 * t3 planned low [] {} by nobody
 * t4 done high [Cara] {Bug}
 */
async function board() {
  const s = await queryScene();
  await s.workspaceLabel("Bug", "#ff0000");
  const t1 = await s.createTask({
    status: "to-do",
    priority: "high",
    assignees: [s.ben.id, s.owner.id],
    labels: ["Bug", "UI"],
    createdBy: s.owner.id,
  });
  const t2 = await s.createTask({
    status: "in-progress",
    priority: "urgent",
    assignees: [s.ben.id],
    labels: ["UI"],
    createdBy: s.ben.id,
  });
  const t3 = await s.createTask({ status: "planned", priority: "low" });
  const t4 = await s.createTask({
    status: "done",
    priority: "high",
    assignees: [s.cara.id],
    labels: ["Bug"],
  });
  return { ...s, t1, t2, t3, t4 };
}

const grouped = (groupBy: string, extra: Record<string, unknown> = {}) => ({
  scope: undefined,
  display: { groupBy, ...extra },
});

describe("API integration: task query grouping", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("groups by status with planned first, then column position", async () => {
    const b = await board();
    const result = await b.query({
      scope: { projectIds: [b.project.id] },
      display: { groupBy: "status" },
    });
    expect(result.groups.map((group) => group.key)).toEqual([
      "planned",
      "to-do",
      "in-progress",
      "done",
    ]);
    expect(idsByGroup(result)).toEqual({
      planned: [b.t3.id],
      "to-do": [b.t1.id],
      "in-progress": [b.t2.id],
      done: [b.t4.id],
    });
    expect(result.totalCount).toBe(4);
  });

  it("groups by group and priority in their fixed orders", async () => {
    const b = await board();
    const byGroup = await b.query(grouped("group"));
    expect(byGroup.groups.map((group) => group.key)).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
    ]);
    const byPriority = await b.query(grouped("priority"));
    expect(byPriority.groups.map((group) => group.key)).toEqual([
      "urgent",
      "high",
      "low",
    ]);
    expect(countsByGroup(byPriority)).toEqual({ urgent: 1, high: 2, low: 1 });
  });

  it("puts a task in every assignee and label group, with exact counts", async () => {
    const b = await board();
    const byAssignee = await b.query(grouped("assignee"));
    // Names ascending (Ben, Cara, Olivia), unassigned last.
    expect(byAssignee.groups.map((group) => group.key)).toEqual([
      b.ben.id,
      b.cara.id,
      b.owner.id,
      "none",
    ]);
    expect(countsByGroup(byAssignee)).toEqual({
      [b.ben.id]: 2,
      [b.cara.id]: 1,
      [b.owner.id]: 1,
      none: 1,
    });
    expect(byAssignee.totalCount).toBe(4);
    expect(sorted(idsByGroup(byAssignee)[b.ben.id] ?? [])).toEqual(
      sorted([b.t1.id, b.t2.id]),
    );

    const byLabel = await b.query(grouped("label"));
    expect(byLabel.groups.map((group) => group.key)).toEqual([
      "name:Bug",
      "name:UI",
      "none",
    ]);
    expect(countsByGroup(byLabel)).toEqual({
      "name:Bug": 2,
      "name:UI": 2,
      none: 1,
    });
    expect(byLabel.totalCount).toBe(4);
    expect(byLabel.meta.labels).toEqual([
      expect.objectContaining({ key: "name:Bug", color: "#ff0000" }),
      expect.objectContaining({ key: "name:UI", workspaceLabelId: null }),
    ]);
  });

  it("groups by creator with none last", async () => {
    const b = await board();
    const result = await b.query(grouped("createdBy"));
    expect(result.groups.map((group) => group.key)).toEqual([
      b.ben.id,
      b.owner.id,
      "none",
    ]);
    expect(countsByGroup(result).none).toBe(2);
  });

  it("orders cycle, module, estimate and project groups", async () => {
    const s = await queryScene();
    const today = todayUtc();
    const cycles = await db
      .insert(schema.cycleTable)
      .values([
        {
          projectId: s.project.id,
          name: "Done",
          startDate: shiftDate(today, -20),
          endDate: shiftDate(today, -10),
        },
        { projectId: s.project.id, name: "Draft" },
        {
          projectId: s.project.id,
          name: "Later",
          startDate: shiftDate(today, 10),
          endDate: shiftDate(today, 20),
        },
        {
          projectId: s.project.id,
          name: "Now",
          startDate: shiftDate(today, -1),
          endDate: shiftDate(today, 1),
        },
      ])
      .returning();
    const byName = new Map(cycles.map((cycle) => [cycle.name, cycle.id]));
    const tasks = [];
    for (const name of ["Done", "Draft", "Later", "Now"]) {
      const task = await s.createTask();
      await db
        .insert(schema.cycleTaskTable)
        .values({ taskId: task.id, cycleId: byName.get(name) ?? "" });
      tasks.push(task);
    }
    await s.createTask();
    const byCycle = await s.query(grouped("cycle"));
    expect(byCycle.groups.map((group) => group.key)).toEqual([
      byName.get("Now"),
      byName.get("Later"),
      byName.get("Draft"),
      byName.get("Done"),
      "none",
    ]);
    expect(byCycle.meta.cycles.map((cycle) => cycle.status).sort()).toEqual([
      "completed",
      "current",
      "draft",
      "upcoming",
    ]);

    const modules = await db
      .insert(schema.moduleTable)
      .values([
        { projectId: s.project.id, name: "Zeta", status: "backlog" },
        { projectId: s.project.id, name: "Alpha", status: "in-progress" },
        { projectId: s.project.id, name: "beta", status: "backlog" },
      ])
      .returning();
    for (const found of modules) {
      await db
        .insert(schema.moduleTaskTable)
        .values({ moduleId: found.id, taskId: tasks[0]?.id ?? "" });
    }
    const byModule = await s.query(grouped("module"));
    expect(byModule.groups.map((group) => group.key)).toEqual([
      modules[2]?.id,
      modules[0]?.id,
      modules[1]?.id,
      "none",
    ]);
    expect(countsByGroup(byModule).none).toBe(4);

    const api = await s.createProject("api");
    await s.createTask({ projectId: api.id });
    const byProject = await s.query(grouped("project"));
    expect(byProject.groups.map((group) => group.key)).toEqual([
      s.project.id,
      api.id,
    ]);
  });

  it("orders estimate groups by point position and reads estimates off as none", async () => {
    const s = await queryScene();
    await s.setFeatures(s.project.id, { estimatesEnabled: true });
    const [system] = await db
      .insert(schema.estimateTable)
      .values({
        projectId: s.project.id,
        name: "Size",
        type: "categories",
        isActive: true,
      })
      .returning();
    const points = await db
      .insert(schema.estimatePointTable)
      .values([
        { estimateId: system?.id ?? "", value: "L", position: 3 },
        { estimateId: system?.id ?? "", value: "S", position: 1 },
      ])
      .returning();
    await s.createTask({ estimatePointId: points[0]?.id });
    await s.createTask({ estimatePointId: points[1]?.id });
    await s.createTask();

    const on = await s.query(grouped("estimate"));
    expect(on.groups.map((group) => group.key)).toEqual([
      points[1]?.id,
      points[0]?.id,
      "none",
    ]);
    await s.setFeatures(s.project.id, { estimatesEnabled: false });
    const off = await s.query(grouped("estimate"));
    expect(countsByGroup(off)).toEqual({ none: 3 });
  });

  it("sub-groups into cells with their own counts", async () => {
    const b = await board();
    const result = await b.query(
      grouped("priority", { subGroupBy: "assignee" }),
    );
    const high = result.groups.find((group) => group.key === "high");
    expect(high?.count).toBe(2);
    expect(high?.subGroups?.map((cell) => [cell.key, cell.count])).toEqual([
      [b.ben.id, 1],
      [b.cara.id, 1],
      [b.owner.id, 1],
    ]);
    expect(
      high?.subGroups?.find((cell) => cell.key === b.owner.id)?.taskIds,
    ).toEqual([b.t1.id]);
    expect(result.totalCount).toBe(4);
  });

  it("lists empty groups when asked, limited by an in filter on the key", async () => {
    const b = await board();
    const all = await b.query(grouped("priority", { showEmptyGroups: true }));
    expect(all.groups.map((group) => group.key)).toEqual([
      "urgent",
      "high",
      "medium",
      "low",
      "no-priority",
    ]);
    expect(countsByGroup(all).medium).toBe(0);

    const limited = await b.query({
      filters: {
        op: "and",
        children: [
          { key: "priority", operator: "in", values: ["urgent", "medium"] },
        ],
      },
      display: { groupBy: "priority", showEmptyGroups: true },
    });
    expect(limited.groups.map((group) => group.key)).toEqual([
      "urgent",
      "medium",
    ]);

    const statuses = await b.query({
      scope: { projectIds: [b.project.id] },
      display: { groupBy: "status", showEmptyGroups: true },
    });
    expect(countsByGroup(statuses)["in-review"]).toBe(0);

    const people = await b.query(
      grouped("assignee", { showEmptyGroups: true }),
    );
    expect(people.groups.map((group) => group.key)).toContain(b.viewer.id);
  });

  it("refuses groupings the scope or display cannot use", async () => {
    const b = await board();
    await b.createProject("api");
    await b.refuse(
      { display: { groupBy: "status" } },
      400,
      "Group by status needs a single project",
    );
    await b.refuse(
      { display: { groupBy: "priority", subGroupBy: "priority" } },
      400,
      "Group and sub-group must differ",
    );
    await b.refuse(
      { display: { subGroupBy: "priority" } },
      400,
      "Group and sub-group must differ",
    );
  });

  it("caps rows at 100 groups and flags the rest", async () => {
    const s = await queryScene();
    const task = await s.createTask();
    for (let i = 0; i < 101; i++) {
      await s.labelTask(task.id, `L${String(i).padStart(3, "0")}`);
    }
    const result = await s.query(grouped("label"));
    expect(result.groups).toHaveLength(101);
    expect(result.hasMoreGroups).toBe(true);
    expect(result.groups[99]?.taskIds).toEqual([task.id]);
    expect(result.groups[100]).toEqual({
      key: "name:L100",
      count: 1,
      taskIds: [],
      nextCursor: null,
    });
  });

  it("returns counts without rows in counts mode", async () => {
    const b = await board();
    const result = await b.query({
      mode: "counts",
      display: { groupBy: "priority" },
    });
    expect(countsByGroup(result)).toEqual({ urgent: 1, high: 2, low: 1 });
    expect(result.groups.every((group) => group.taskIds === undefined)).toBe(
      true,
    );
    expect(result.tasks).toEqual({});
  });
});
