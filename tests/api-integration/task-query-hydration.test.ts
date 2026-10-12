import pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { runTaskQuery } from "../../apps/api/src/task-query";
import { shiftDate, todayUtc } from "../../apps/api/src/utils/calendar-date";
import { resetTestDatabase } from "./helpers/database";
import { queryScene } from "./helpers/task-query";

const EVERY_INCLUDE = [
  "labels",
  "assignees",
  "cycle",
  "modules",
  "estimate",
  "subTasks",
  "customFields",
  "externalLinks",
];

/** A project with every planning feature on and one of everything. */
async function richScene() {
  const s = await queryScene();
  await s.setFeatures(s.project.id, { estimatesEnabled: true });
  const today = todayUtc();
  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({
      projectId: s.project.id,
      name: "Sprint",
      startDate: shiftDate(today, -1),
      endDate: shiftDate(today, 5),
    })
    .returning();
  const [activeModule, archivedModule] = await db
    .insert(schema.moduleTable)
    .values([
      { projectId: s.project.id, name: "Checkout" },
      { projectId: s.project.id, name: "Gone", archivedAt: new Date() },
    ])
    .returning();
  const [system] = await db
    .insert(schema.estimateTable)
    .values({
      projectId: s.project.id,
      name: "Points",
      type: "points",
      isActive: true,
    })
    .returning();
  const [point] = await db
    .insert(schema.estimatePointTable)
    .values({
      estimateId: system?.id ?? "",
      value: "5",
      numericValue: 5,
      position: 1,
    })
    .returning();
  const [field] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({ projectId: s.project.id, name: "Impact", type: "text" })
    .returning();
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: s.project.id,
      type: "github",
      config: "{}",
      isActive: true,
    })
    .returning();
  if (
    !cycle ||
    !activeModule ||
    !archivedModule ||
    !point ||
    !field ||
    !integration
  ) {
    throw new Error("fixtures");
  }
  return {
    ...s,
    cycle,
    activeModule,
    archivedModule,
    point,
    field,
    integration,
  };
}

describe("API integration: task query rows and meta", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns the basic row and every include", async () => {
    const r = await richScene();
    await r.workspaceLabel("Bug", "#ff0000");
    const task = await r.createTask({
      title: "Checkout fails",
      priority: "high",
      assignees: [r.cara.id, r.ben.id],
      createdBy: r.owner.id,
      estimatePointId: r.point.id,
      dueDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    await r.labelTask(task.id, "Bug", "#000000");
    await r.labelTask(task.id, "Local", "#00ff00");
    const child = await r.createTask();
    const hiddenChild = await r.createTask({ archivedAt: new Date() });
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: task.id,
        targetTaskId: child.id,
        relationType: "subtask",
      },
      {
        sourceTaskId: task.id,
        targetTaskId: hiddenChild.id,
        relationType: "subtask",
      },
    ]);
    await db
      .insert(schema.cycleTaskTable)
      .values({ taskId: task.id, cycleId: r.cycle.id });
    await db.insert(schema.moduleTaskTable).values([
      { moduleId: r.activeModule.id, taskId: task.id },
      { moduleId: r.archivedModule.id, taskId: task.id },
    ]);
    await db.insert(schema.customFieldValueTable).values({
      taskId: task.id,
      fieldId: r.field.id,
      value: "Revenue",
    });
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId: r.integration.id,
      resourceType: "issue",
      externalId: "7",
      url: "https://example.test/issues/7",
      metadata: JSON.stringify({ state: "open" }),
    });

    const result = await r.query({
      filters: { key: "project", operator: "in", values: [r.project.id] },
      include: EVERY_INCLUDE,
      display: { orderBy: { field: "number", direction: "asc" } },
    });
    const row = result.tasks[task.id];
    expect(row).toMatchObject({
      id: task.id,
      projectId: r.project.id,
      number: 1,
      key: "WEB-1",
      title: "Checkout fails",
      status: "to-do",
      columnId: r.columns.todo.id,
      group: "unstarted",
      priority: "high",
      dueDate: "2026-10-01T00:00:00.000Z",
      archivedAt: null,
      createdBy: r.owner.id,
      // The first assignee.
      userId: r.cara.id,
      assigneeIds: [r.cara.id, r.ben.id],
      labels: [
        { name: "Bug", color: "#ff0000" },
        { name: "Local", color: "#00ff00" },
      ],
      cycleId: r.cycle.id,
      moduleIds: [r.activeModule.id],
      estimatePointId: r.point.id,
      parentId: null,
      subTaskCount: 1,
      customFieldValues: [{ fieldId: r.field.id, value: "Revenue" }],
    });
    expect(row?.externalLinks).toEqual([
      expect.objectContaining({
        url: "https://example.test/issues/7",
        metadata: { state: "open" },
      }),
    ]);
    expect(result.tasks[child.id]?.parentId).toBe(task.id);

    // Meta: only referenced users (no emails), the project's columns and
    // the referenced cycle, module and point.
    expect(result.meta.users.map((user) => user.id).sort()).toEqual(
      [r.ben.id, r.cara.id, r.owner.id].sort(),
    );
    expect(result.meta.users.every((user) => !("email" in user))).toBe(true);
    expect(result.meta.projects.map((project) => project.id)).toEqual([
      r.project.id,
    ]);
    expect(result.meta.columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
    expect(result.meta.cycles).toEqual([
      expect.objectContaining({ id: r.cycle.id, status: "current" }),
    ]);
    expect(result.meta.modules.map((found) => found.id)).toEqual([
      r.activeModule.id,
    ]);
    expect(result.meta.estimatePoints).toEqual([
      expect.objectContaining({ id: r.point.id, value: "5" }),
    ]);
    expect(result.meta.customFields.map((found) => found.id)).toEqual([
      r.field.id,
    ]);
  });

  it("reads switched-off features as no value", async () => {
    const r = await richScene();
    const task = await r.createTask({ estimatePointId: r.point.id });
    await db
      .insert(schema.cycleTaskTable)
      .values({ taskId: task.id, cycleId: r.cycle.id });
    await db
      .insert(schema.moduleTaskTable)
      .values({ moduleId: r.activeModule.id, taskId: task.id });
    await r.setFeatures(r.project.id, {
      cyclesEnabled: false,
      modulesEnabled: false,
      estimatesEnabled: false,
    });

    const result = await r.query({ include: EVERY_INCLUDE });
    expect(result.tasks[task.id]).toMatchObject({
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
    });
    expect(result.meta.cycles).toEqual([]);
    expect(result.meta.modules).toEqual([]);
    expect(result.meta.estimatePoints).toEqual([]);
  });

  it("runs a fixed number of statements whatever the page size", async () => {
    const r = await richScene();
    const label = "Shared";
    const people = [r.owner.id, r.ben.id, r.cara.id];
    const tasks = await db
      .insert(schema.taskTable)
      .values(
        Array.from({ length: 450 }, (_, i) => ({
          projectId: r.project.id,
          title: `Bulk ${i}`,
          number: i + 1,
          position: i,
          status: "to-do",
          columnId: r.columns.todo.id,
          priority: "medium",
          createdBy: r.owner.id,
          estimatePointId: r.point.id,
        })),
      )
      .returning({ id: schema.taskTable.id });
    await db.insert(schema.taskAssigneeTable).values(
      tasks.map((task, i) => ({
        taskId: task.id,
        userId: people[i % people.length] ?? r.owner.id,
      })),
    );
    await db.insert(schema.labelTable).values(
      tasks.map((task) => ({
        taskId: task.id,
        name: label,
        color: "#123456",
        workspaceId: r.workspaceId,
      })),
    );
    await db
      .insert(schema.cycleTaskTable)
      .values(tasks.map((task) => ({ taskId: task.id, cycleId: r.cycle.id })));
    await db
      .insert(schema.moduleTaskTable)
      .values(
        tasks.map((task) => ({ moduleId: r.activeModule.id, taskId: task.id })),
      );

    const request = (limit: number) => ({
      workspaceId: r.workspaceId,
      filters: {
        op: "and" as const,
        children: [
          { key: "priority", operator: "in", values: ["medium"] },
          {
            key: "customField",
            operator: "notIn",
            values: ["x"],
            fieldId: r.field.id,
          },
        ],
      },
      include: EVERY_INCLUDE as never,
      display: { groupBy: "assignee" as const, subGroupBy: "label" as const },
      page: { limit },
    });
    const caller = { workspaceId: r.workspaceId, userId: r.owner.id };
    const spy = vi.spyOn(pg.Client.prototype, "query");

    const statements = async (limit: number) => {
      spy.mockClear();
      const result = await runTaskQuery(request(limit), caller);
      return { count: spy.mock.calls.length, result };
    };
    const small = await statements(10);
    const large = await statements(200);

    expect(Object.keys(small.result.tasks)).toHaveLength(30);
    expect(Object.keys(large.result.tasks)).toHaveLength(450);
    expect(large.count).toBe(small.count);
    // BEGIN, the statement timeout and COMMIT, plus at most 19 reads; the
    // lower bound proves the spy sees the engine's statements.
    expect(small.count).toBeGreaterThanOrEqual(10);
    expect(small.count - 3).toBeLessThanOrEqual(19);
  });
});
