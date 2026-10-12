import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  activityTypes,
  apiKeyFor,
  clearPublishedEvents,
  intakeRow,
  intakeScene,
  json,
  publishedEvents,
  recordEvents,
  settle,
  settledActivity,
  taskRow,
} from "./helpers/intake";

recordEvents("intake.item_created", "task.created");

async function triageColumns(projectId: string) {
  return db
    .select()
    .from(schema.columnTable)
    .where(
      and(
        eq(schema.columnTable.projectId, projectId),
        eq(schema.columnTable.group, "triage"),
      ),
    );
}

describe("API integration: intake submission", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("files a request as a task in a new triage column", async () => {
    const scene = await intakeScene();
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 7 })
      .where(eq(schema.projectTable.id, scene.project.id));

    const item = await scene.submit(scene.member, {
      title: "  Dark mode  ",
      description: "Please",
    });
    expect(item).toMatchObject({
      projectId: scene.project.id,
      status: "pending",
      source: "in_app",
      snoozedUntil: null,
      resolutionNote: null,
      submittedBy: { id: scene.member.id, name: "Ben" },
      triagedBy: null,
      duplicateOf: null,
      task: {
        number: 8,
        key: "WEB-8",
        title: "Dark mode",
        priority: "no-priority",
        status: "triage",
        columnName: "Triage",
        group: "triage",
        assigneeId: null,
        dueDate: null,
      },
    });

    const [column] = await triageColumns(scene.project.id);
    expect(column).toMatchObject({
      name: "Triage",
      slug: "triage",
      icon: "Inbox",
      isFinal: false,
      position: 4,
    });
    const task = await taskRow(item.taskId);
    expect(task).toMatchObject({
      columnId: column?.id,
      completedAt: null,
      createdBy: scene.member.id,
      description: "Please",
    });

    // A second request reuses the column.
    const second = await scene.submit(scene.viewer);
    expect(second.task.number).toBe(9);
    expect(await triageColumns(scene.project.id)).toHaveLength(1);
  });

  it("picks a free slug when a column already uses triage", async () => {
    const scene = await intakeScene();
    await db.insert(schema.columnTable).values({
      projectId: scene.project.id,
      name: "Triage board",
      slug: "triage",
      position: 4,
      group: "started",
    });
    const item = await scene.submit(scene.member);
    expect(item.task.status).toBe("triage-2");
    const [column] = await triageColumns(scene.project.id);
    expect(column).toMatchObject({ slug: "triage-2", position: 5 });
  });

  it("creates one triage column under concurrent first submissions", async () => {
    const scene = await intakeScene();
    const { app } = createApp();
    const { mockAuthenticatedSession } = await import("./helpers/auth");
    mockAuthenticatedSession(scene.member);
    const responses = await Promise.all(
      [1, 2, 3].map((n) =>
        app.request(
          `/api/intake/project/${scene.project.id}`,
          json("POST", { title: `Request ${n}` }),
        ),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await triageColumns(scene.project.id)).toHaveLength(1);
  });

  it("applies required custom-field defaults and never requires fields", async () => {
    const scene = await intakeScene();
    const [withDefault, withoutDefault] = await db
      .insert(schema.customFieldDefinitionTable)
      .values([
        {
          projectId: scene.project.id,
          name: "Team",
          type: "dropdown",
          options: ["Core", "Web"],
          required: true,
          defaultValue: "Core",
        },
        {
          projectId: scene.project.id,
          name: "Budget",
          type: "number",
          required: true,
        },
      ])
      .returning();

    const item = await scene.submit(scene.viewer);
    const values = await db
      .select()
      .from(schema.customFieldValueTable)
      .where(eq(schema.customFieldValueTable.taskId, item.taskId));
    expect(values.map((v) => [v.fieldId, v.value])).toEqual([
      [withDefault?.id, "Core"],
    ]);
    expect(values.some((v) => v.fieldId === withoutDefault?.id)).toBe(false);
  });

  it("validates the body", async () => {
    const scene = await intakeScene();
    const post = (body: unknown) =>
      scene.as(scene.member)(
        `/intake/project/${scene.project.id}`,
        json("POST", body),
      );
    expect((await post({ title: "   " })).status).toBe(400);
    expect((await post({ title: "x".repeat(501) })).status).toBe(400);
    expect((await post({ title: "x".repeat(500) })).status).toBe(200);
    expect((await post({ title: "Ok", priority: "critical" })).status).toBe(
      400,
    );
    expect((await post({ title: "Ok", status: "done" })).status).toBe(400);
    expect(
      (await post({ title: "Ok", description: "x".repeat(50_001) })).status,
    ).toBe(400);
  });

  it("refuses archived projects", async () => {
    const scene = await intakeScene();
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, scene.project.id));
    const response = await scene.as(scene.member)(
      `/intake/project/${scene.project.id}`,
      json("POST", { title: "Late" }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("This project is archived");
  });

  it("records the api source for API keys", async () => {
    const scene = await intakeScene();
    const headers = await apiKeyFor(scene.member, {
      project: ["read"],
      intake: ["create"],
    });
    const response = await scene.app.request(
      `/api/intake/project/${scene.project.id}`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: "From a script" }),
      },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { source: string }).source).toBe("api");
  });

  it("keeps the request off the board and statistics, without task.created", async () => {
    const scene = await intakeScene();
    await scene.createBoardTask({ status: "done" });
    const item = await scene.submit(scene.member);

    const board = await scene.as(scene.admin)(
      `/task/tasks/${scene.project.id}`,
    );
    expect(board.status).toBe(200);
    const data = (
      (await board.json()) as {
        data: {
          columns: Array<{ slug: string; tasks: Array<{ id: string }> }>;
          plannedTasks: Array<{ id: string }>;
          archivedTasks: Array<{ id: string }>;
        };
      }
    ).data;
    const ids = [
      ...data.columns.flatMap((c) => c.tasks.map((t) => t.id)),
      ...data.plannedTasks.map((t) => t.id),
      ...data.archivedTasks.map((t) => t.id),
    ];
    expect(ids).not.toContain(item.taskId);
    expect(data.columns.map((c) => c.slug)).not.toContain("triage");

    const projects = await scene.as(scene.admin)(
      `/project?workspaceId=${scene.workspace.id}`,
    );
    const [project] = (await projects.json()) as Array<{
      statistics: { totalTasks: number; completionPercentage: number };
    }>;
    expect(project?.statistics).toMatchObject({
      totalTasks: 1,
      completionPercentage: 100,
    });

    await settle();
    expect(publishedEvents("intake.item_created")).toHaveLength(1);
    expect(publishedEvents("intake.item_created")[0]?.data).toMatchObject({
      intakeItemId: item.id,
      taskId: item.taskId,
      projectId: scene.project.id,
      workspaceId: scene.workspace.id,
      userId: scene.member.id,
      taskKey: "WEB-1",
      source: "in_app",
    });
    expect(publishedEvents("task.created")).toHaveLength(0);

    const [submitted] = await settledActivity(item.taskId, "intake_submitted");
    expect(submitted).toMatchObject({
      userId: scene.member.id,
      eventData: { source: "in_app" },
    });
    expect(
      (await activityTypes(item.taskId)).some((r) => r.type === "created"),
    ).toBe(false);
  });
});

describe("API integration: intake list", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function seeded() {
    const scene = await intakeScene();
    const a = await scene.submit(scene.member, {
      title: "Login bug",
      priority: "high",
    });
    const b = await scene.submit(scene.viewer, {
      title: "Export to CSV",
      priority: "low",
    });
    const c = await scene.submit(scene.member, { title: "Faster search" });
    const d = await scene.submit(scene.viewer, { title: "Old idea" });
    const e = await scene.submit(scene.admin, { title: "Declined thing" });
    const f = await scene.submit(scene.admin, { title: "Accepted thing" });
    // Distinct, known submission times: a is the oldest.
    const base = Date.parse("2026-09-01T10:00:00Z");
    for (const [index, item] of [a, b, c, d, e, f].entries()) {
      await db
        .update(schema.intakeItemTable)
        .set({ createdAt: new Date(base + index * 60_000) })
        .where(eq(schema.intakeItemTable.id, item.id));
    }
    await db
      .update(schema.intakeItemTable)
      .set({
        status: "snoozed",
        snoozedUntil: new Date(Date.now() + 86_400_000),
      })
      .where(eq(schema.intakeItemTable.id, d.id));
    expect((await scene.action(scene.admin, e.id, "decline")).status).toBe(200);
    expect(
      (await scene.action(scene.admin, f.id, "accept", { status: "to-do" }))
        .status,
    ).toBe(200);
    return { ...scene, a, b, c, d, e, f };
  }

  it("lists the open tab's pending requests by default, newest first", async () => {
    const s = await seeded();
    const list = await s.list(s.viewer);
    expect(list.items.map((i) => i.id)).toEqual([s.c.id, s.b.id, s.a.id]);
    expect(list).toMatchObject({
      page: 1,
      limit: 50,
      total: 3,
      hasMore: false,
      counts: {
        pending: 3,
        snoozed: 1,
        accepted: 1,
        declined: 1,
        duplicate: 0,
      },
    });

    const snoozed = await s.list(s.viewer, "status=snoozed");
    expect(snoozed.items.map((i) => i.id)).toEqual([s.d.id]);
    expect(snoozed.items[0]?.snoozedUntil).not.toBeNull();

    const closed = await s.list(s.viewer, "tab=closed");
    expect(closed.items.map((i) => i.id)).toEqual([s.f.id, s.e.id]);
    expect(closed.items[0]?.task).toMatchObject({
      status: "to-do",
      columnName: "To Do",
      group: "unstarted",
    });
    expect(closed.total).toBe(2);
  });

  it("rejects statuses outside the tab and unknown priorities", async () => {
    const s = await seeded();
    const bad = await s.as(s.viewer)(
      `/intake/project/${s.project.id}?tab=open&status=accepted`,
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe(
      "Status accepted doesn't belong to the open tab",
    );
    const priority = await s.as(s.viewer)(
      `/intake/project/${s.project.id}?priority=critical`,
    );
    expect(priority.status).toBe(400);
  });

  it("searches by title, key and bare number", async () => {
    const s = await seeded();
    const byTitle = await s.list(s.viewer, "search=login");
    expect(byTitle.items.map((i) => i.id)).toEqual([s.a.id]);
    const byKey = await s.list(s.viewer, `search=web-${s.b.task.number}`);
    expect(byKey.items.map((i) => i.id)).toEqual([s.b.id]);
    const byNumber = await s.list(s.viewer, `search=${s.c.task.number}`);
    expect(byNumber.items.map((i) => i.id)).toEqual([s.c.id]);
    // Wildcards are literal.
    const wildcard = await s.list(s.viewer, "search=%25");
    expect(wildcard.items).toEqual([]);
    // counts follow the search too.
    expect(byTitle.counts).toMatchObject({ pending: 1, snoozed: 0 });
  });

  it("filters by priority and submitter", async () => {
    const s = await seeded();
    const high = await s.list(s.viewer, "priority=high,low");
    expect(high.items.map((i) => i.id)).toEqual([s.b.id, s.a.id]);
    const mine = await s.list(s.member, "submittedBy=me");
    expect(mine.items.map((i) => i.id)).toEqual([s.c.id, s.a.id]);
    const vics = await s.list(s.member, `submittedBy=${s.viewer.id}`);
    expect(vics.items.map((i) => i.id)).toEqual([s.b.id]);
    expect(vics.counts).toMatchObject({ pending: 1, snoozed: 1 });
  });

  it("sorts by submission, activity and number both ways", async () => {
    const s = await seeded();
    const asc = await s.list(s.viewer, "sortOrder=asc");
    expect(asc.items.map((i) => i.id)).toEqual([s.a.id, s.b.id, s.c.id]);

    const byNumber = await s.list(s.viewer, "sortBy=number&sortOrder=desc");
    expect(byNumber.items.map((i) => i.task.number)).toEqual(
      [s.a, s.b, s.c].map((i) => i.task.number).sort((x, y) => y - x),
    );

    // Last activity is the later of the request's and its task's change.
    // Explicit instants keep the test off the app and database clocks.
    const at = (iso: string) => new Date(iso);
    const setTask = (taskId: string, iso: string) =>
      db
        .update(schema.taskTable)
        .set({ updatedAt: at(iso) })
        .where(eq(schema.taskTable.id, taskId));
    const setItem = (itemId: string, iso: string) =>
      db
        .update(schema.intakeItemTable)
        .set({ updatedAt: at(iso) })
        .where(eq(schema.intakeItemTable.id, itemId));
    await setTask(s.a.taskId, "2026-09-05T00:00:00Z");
    await setItem(s.a.id, "2026-09-01T00:00:00Z");
    await setTask(s.b.taskId, "2026-09-02T00:00:00Z");
    await setItem(s.b.id, "2026-09-04T00:00:00Z");
    await setTask(s.c.taskId, "2026-09-03T00:00:00Z");
    await setItem(s.c.id, "2026-09-01T00:00:00Z");

    const byActivity = await s.list(s.viewer, "sortBy=updatedAt");
    expect(byActivity.items.map((i) => i.id)).toEqual([s.a.id, s.b.id, s.c.id]);
    const byActivityAsc = await s.list(
      s.viewer,
      "sortBy=updatedAt&sortOrder=asc",
    );
    expect(byActivityAsc.items.map((i) => i.id)).toEqual([
      s.c.id,
      s.b.id,
      s.a.id,
    ]);
  });

  it("pages with limit, total and hasMore", async () => {
    const s = await seeded();
    const first = await s.list(s.viewer, "limit=2");
    expect(first).toMatchObject({ page: 1, limit: 2, total: 3, hasMore: true });
    expect(first.items.map((i) => i.id)).toEqual([s.c.id, s.b.id]);
    const second = await s.list(s.viewer, "limit=2&page=2");
    expect(second).toMatchObject({ page: 2, total: 3, hasMore: false });
    expect(second.items.map((i) => i.id)).toEqual([s.a.id]);
    expect(
      (await s.as(s.viewer)(`/intake/project/${s.project.id}?limit=101`))
        .status,
    ).toBe(400);
  });

  it("gets a request by id and by task", async () => {
    const s = await seeded();
    const byId = await s.as(s.viewer)(`/intake/item/${s.a.id}`);
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as { id: string }).id).toBe(s.a.id);

    const byTask = await s.as(s.viewer)(`/intake/task/${s.f.taskId}`);
    expect(byTask.status).toBe(200);
    expect(await byTask.json()).toMatchObject({
      id: s.f.id,
      status: "accepted",
      triagedBy: { id: s.admin.id },
    });

    const board = await s.createBoardTask();
    const notFromIntake = await s.as(s.viewer)(`/intake/task/${board.id}`);
    expect(notFromIntake.status).toBe(404);
    expect(await notFromIntake.text()).toBe(
      "This task didn't come from intake",
    );

    expect((await s.as(s.viewer)("/intake/item/unknown")).status).toBe(404);
  });

  it("returns the summary of open requests", async () => {
    const s = await seeded();
    const response = await s.as(s.member)(
      `/intake/project/${s.project.id}/summary`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: 3, snoozed: 1 });
  });
});

describe("API integration: intake edits", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets the requester edit an open request through the task edits", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer, { title: "Old title" });
    const response = await scene.as(scene.viewer)(
      `/intake/item/${item.id}`,
      json("PATCH", {
        title: "New title",
        description: "More detail",
        priority: "urgent",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      task: { title: "New title", priority: "urgent" },
    });
    expect(await taskRow(item.taskId)).toMatchObject({
      title: "New title",
      description: "More detail",
      priority: "urgent",
    });
    await settledActivity(item.taskId, "title_changed");
    await settledActivity(item.taskId, "priority_changed");

    // Unchanged values are skipped; nothing to change is refused.
    const same = await scene.as(scene.viewer)(
      `/intake/item/${item.id}`,
      json("PATCH", { title: "New title" }),
    );
    expect(same.status).toBe(200);
    await settle();
    expect(
      (await activityTypes(item.taskId)).filter(
        (r) => r.type === "title_changed",
      ),
    ).toHaveLength(1);
    const empty = await scene.as(scene.viewer)(
      `/intake/item/${item.id}`,
      json("PATCH", {}),
    );
    expect(empty.status).toBe(400);
    expect(await empty.text()).toBe("Provide a title, description or priority");
    const unknownKey = await scene.as(scene.viewer)(
      `/intake/item/${item.id}`,
      json("PATCH", { status: "done" }),
    );
    expect(unknownKey.status).toBe(400);
  });

  it("closes requester edits once the request is decided", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await scene.action(scene.member, item.id, "decline");

    const requester = await scene.as(scene.viewer)(
      `/intake/item/${item.id}`,
      json("PATCH", { title: "Please reconsider" }),
    );
    expect(requester.status).toBe(409);
    expect(await requester.text()).toBe("This request is closed");

    // Members edit through task:update, whatever the status.
    const member = await scene.as(scene.member)(
      `/intake/item/${item.id}`,
      json("PATCH", { title: "Clarified" }),
    );
    expect(member.status).toBe(200);
    expect((await intakeRow(item.id))?.status).toBe("declined");
  });

  it("refuses edits by others without task:update", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.member);
    const viewer = await scene.as(scene.viewer)(
      `/intake/item/${item.id}`,
      json("PATCH", { title: "Hijack" }),
    );
    expect(viewer.status).toBe(403);
    expect(await viewer.text()).toBe(
      "Only the requester can edit an open request",
    );
  });
});
