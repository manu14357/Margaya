import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishTaskDraft } from "../../apps/api/src/task-draft/controllers/publish-draft";
import { resetTestDatabase } from "./helpers/database";
import { day, draftScene, type PublishedJson } from "./helpers/drafts";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
  settle,
} from "./helpers/intake";

recordEvents(
  "task.created",
  "task.label_created",
  "cycle.tasks_changed",
  "module.tasks_changed",
  "task_draft.changed",
);

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function taskRow(taskId: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return row;
}

async function assigneeRows(taskId: string) {
  return db
    .select({
      userId: schema.taskAssigneeTable.userId,
      position: schema.taskAssigneeTable.position,
    })
    .from(schema.taskAssigneeTable)
    .where(eq(schema.taskAssigneeTable.taskId, taskId))
    .orderBy(asc(schema.taskAssigneeTable.position));
}

describe("publishing a draft", () => {
  it("creates the task with the draft's values and deletes the draft", async () => {
    const s = await draftScene();
    const field = await s.insertField();
    await db.insert(schema.taskTable).values({
      projectId: s.web.project.id,
      title: "Existing",
      number: 1,
      status: "to-do",
    });
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 1 })
      .where(eq(schema.projectTable.id, s.web.project.id));

    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Ship the login page",
      description: "Details",
      status: "in-progress",
      priority: "high",
      assigneeIds: [s.ada.id, s.mia.id],
      labels: [
        { name: "UI", color: "purple" },
        { name: "Auth", color: "teal" },
      ],
      startDate: "2026-05-01",
      dueDate: "2026-05-10",
      customFieldValues: [{ fieldId: field.id, value: "Core" }],
    });
    clearPublishedEvents();

    const published = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${draft.id}/publish`,
    );
    expect(published.key).toBe("web-2");
    expect(published.dropped).toEqual([]);
    expect(published.task).toMatchObject({
      number: 2,
      title: "Ship the login page",
      description: "Details",
      status: "in-progress",
      priority: "high",
      userId: s.ada.id,
      assigneeIds: [s.ada.id, s.mia.id],
      createdBy: s.mia.id,
      startDate: "2026-05-01T00:00:00.000Z",
      dueDate: "2026-05-10T00:00:00.000Z",
    });

    const task = await taskRow(published.task.id);
    expect(task).toMatchObject({
      columnId: s.web.columns.inProgress.id,
      createdBy: s.mia.id,
    });
    expect(await assigneeRows(published.task.id)).toEqual([
      { userId: s.ada.id, position: 0 },
      { userId: s.mia.id, position: 1 },
    ]);
    const labels = await db
      .select({
        name: schema.labelTable.name,
        color: schema.labelTable.color,
        workspaceId: schema.labelTable.workspaceId,
      })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, published.task.id))
      .orderBy(asc(schema.labelTable.name));
    expect(labels).toEqual([
      { name: "Auth", color: "teal", workspaceId: s.workspaceId },
      { name: "UI", color: "purple", workspaceId: s.workspaceId },
    ]);
    const values = await db
      .select({ value: schema.customFieldValueTable.value })
      .from(schema.customFieldValueTable)
      .where(eq(schema.customFieldValueTable.taskId, published.task.id));
    expect(values).toEqual([{ value: "Core" }]);
    expect(await s.draftRow(draft.id)).toBeNull();
    expect(await s.lastTaskNumber()).toBe(2);

    expect(publishedEvents().map((event) => event.name)).toEqual([
      "task.created",
      "task.label_created",
      "task.label_created",
      "task_draft.changed",
    ]);
    expect(publishedEvents("task.created")[0]?.data).toMatchObject({
      taskId: published.task.id,
      currentUserId: s.mia.id,
      assigneeIds: [s.ada.id, s.mia.id],
      type: "created",
      source: "draft",
    });
    expect(publishedEvents("task_draft.changed")[0]?.data).toMatchObject({
      draftId: draft.id,
      action: "published",
    });

    // One "created" row, written by the publish itself.
    await settle();
    const history = await db
      .select({
        type: schema.activityTable.type,
        userId: schema.activityTable.userId,
      })
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, published.task.id),
          eq(schema.activityTable.type, "created"),
        ),
      );
    expect(history).toEqual([{ type: "created", userId: s.mia.id }]);
  });

  it("saves a body patch first and keeps it when publishing fails", async () => {
    const s = await draftScene();
    await s.insertField({ required: true, name: "Team" });
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Old title",
    });
    const response = await s.as(s.mia)(
      "POST",
      `/task-draft/${draft.id}/publish`,
      { title: "New title" },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      'Custom field "Team" is required to create a task.',
    );
    expect(await s.draftRow(draft.id)).toMatchObject({ title: "New title" });
    expect(await s.lastTaskNumber()).toBe(0);
  });

  it("refuses a draft without a project or title, or in an archived project", async () => {
    const s = await draftScene();
    const publish = (id: string) =>
      s.as(s.mia)("POST", `/task-draft/${id}/publish`, {});

    const noProject = await s.createDraft(s.mia, { title: "Loose" });
    let response = await publish(noProject.id);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Choose a project before publishing");

    const blank = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "   ",
    });
    response = await publish(blank.id);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Give the task a title before publishing",
    );

    const archived = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Later",
    });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, s.web.project.id));
    response = await publish(archived.id);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("This project is archived");
    expect(await s.draftRow(archived.id)).not.toBeNull();
    expect(await s.lastTaskNumber()).toBe(0);
  });

  it("resolves the status and drops stale assignees", async () => {
    const s = await draftScene();
    const noStatus = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Entry column",
    });
    const staleStatus = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Stale status",
      status: "in-review",
      assigneeIds: [s.ada.id, s.mia.id],
    });
    const planned = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Backlog",
      status: "planned",
    });
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.id, s.web.columns.inReview.id));
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.ada.id));

    const first = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${noStatus.id}/publish`,
    );
    expect(first.task.status).toBe("to-do");
    expect(first.dropped).toEqual([]);

    const second = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${staleStatus.id}/publish`,
    );
    expect(second.task.status).toBe("to-do");
    expect(second.task.assigneeIds).toEqual([s.mia.id]);
    expect(second.dropped).toEqual(["status", "assignees"]);

    const third = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${planned.id}/publish`,
    );
    expect(third.task.status).toBe("planned");
  });

  it("joins an assignable cycle and drops one that completed", async () => {
    const s = await draftScene();
    const running = await s.insertCycle({ name: "Now" });
    const ending = await s.insertCycle({
      name: "Ending",
      startDate: day(-20),
      endDate: day(-11),
    });
    const kept = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Planned",
      cycleId: running.id,
    });
    // Saving accepts a completed cycle; publishing decides.
    const stale = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Late",
      cycleId: ending.id,
    });
    clearPublishedEvents();

    const joined = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${kept.id}/publish`,
    );
    expect(joined.dropped).toEqual([]);
    const [membership] = await db
      .select()
      .from(schema.cycleTaskTable)
      .where(eq(schema.cycleTaskTable.taskId, joined.task.id));
    expect(membership).toMatchObject({
      cycleId: running.id,
      addedBy: s.mia.id,
    });
    expect(publishedEvents().map((event) => event.name)).toEqual([
      "task.created",
      "cycle.tasks_changed",
      "task_draft.changed",
    ]);

    const dropped = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${stale.id}/publish`,
    );
    expect(dropped.dropped).toEqual(["cycle"]);
    const none = await db
      .select()
      .from(schema.cycleTaskTable)
      .where(eq(schema.cycleTaskTable.taskId, dropped.task.id));
    expect(none).toEqual([]);

    // History reads in order: created first, then the cycle.
    await settle();
    const history = await db
      .select({ type: schema.activityTable.type })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, joined.task.id))
      .orderBy(asc(schema.activityTable.createdAt));
    expect(history.map((row) => row.type)).toEqual([
      "created",
      "cycle_changed",
    ]);
  });

  it("drops the cycle when cycles were turned off, and archived modules", async () => {
    const s = await draftScene();
    const cycle = await s.insertCycle();
    const active = await s.insertModule({ name: "Active" });
    const later = await s.insertModule({ name: "Later", status: "completed" });
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Planned work",
      cycleId: cycle.id,
      moduleIds: [active.id, later.id],
    });
    await db
      .update(schema.moduleTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.moduleTable.id, later.id));
    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));

    const published = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${draft.id}/publish`,
    );
    expect(published.dropped).toEqual(["cycle", "modules"]);
    const modules = await db
      .select({ moduleId: schema.moduleTaskTable.moduleId })
      .from(schema.moduleTaskTable)
      .where(eq(schema.moduleTaskTable.taskId, published.task.id));
    expect(modules).toEqual([{ moduleId: active.id }]);
    expect(publishedEvents("module.tasks_changed")[0]?.data).toMatchObject({
      moduleId: active.id,
      added: [published.task.id],
    });
  });

  it("keeps a point of the active estimate and drops one of a replaced estimate", async () => {
    const s = await draftScene();
    const first = await s.insertEstimate();
    const keep = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Estimated",
      estimatePointId: first.points[1]?.id,
    });
    const stale = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Re-estimated",
      estimatePointId: first.points[2]?.id,
    });

    const kept = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${keep.id}/publish`,
    );
    expect(kept.task.estimatePointId).toBe(first.points[1]?.id);

    await db
      .update(schema.estimateTable)
      .set({ isActive: false })
      .where(eq(schema.estimateTable.id, first.estimate.id));
    await s.insertEstimate();
    const dropped = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${stale.id}/publish`,
    );
    expect(dropped.dropped).toEqual(["estimate"]);
    expect(dropped.task.estimatePointId).toBeNull();
  });

  it("creates exactly one task when the same draft is published twice at once", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Once",
    });
    const publish = s.as(s.mia);
    const responses = await Promise.all([
      publish("POST", `/task-draft/${draft.id}/publish`, {}),
      publish("POST", `/task-draft/${draft.id}/publish`, {}),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    const tasks = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.web.project.id));
    expect(tasks).toHaveLength(1);
    expect(await s.lastTaskNumber()).toBe(1);
  });

  it("uses an edited draft as the publish source", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, { title: "Draft" });
    const published = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${draft.id}/publish`,
      { projectId: s.api.project.id, priority: "urgent" },
    );
    expect(published).toMatchObject({
      key: "api-1",
      task: { projectId: s.api.project.id, priority: "urgent", title: "Draft" },
    });
    const read = await s.as(s.mia)("GET", `/task-draft/${draft.id}`);
    expect(read.status).toBe(404);
  });
});

describe("drafts: a project change racing a publish", () => {
  it("refuses a draft moved after the permission check ran", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, { title: "Raced" });

    await expect(
      publishTaskDraft({
        draftId: draft.id,
        userId: s.mia.id,
        patch: { projectId: s.web.project.id },
        authorizedProjectId: "project-the-check-looked-at",
      }),
    ).rejects.toMatchObject({ status: 409 });

    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.title, "Raced"));
    expect(tasks).toEqual([]);
  });
});
