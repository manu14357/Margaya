import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  activityTypes,
  clearPublishedEvents,
  type IntakeItemJson,
  intakeRow,
  intakeScene,
  notificationsFor,
  publishedEvents,
  recordEvents,
  settle,
  settledActivity,
  taskRow,
} from "./helpers/intake";

recordEvents("task.created", "intake.item_updated");

const DAY_MS = 24 * 60 * 60 * 1000;

function inFuture(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

async function body(response: Response) {
  return (await response.json()) as IntakeItemJson;
}

describe("API integration: accepting intake requests", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("moves the task to the end of a started column and announces it", async () => {
    const scene = await intakeScene();
    await scene.createBoardTask({ status: "in-progress", position: 1 });
    await scene.createBoardTask({ status: "in-progress", position: 2 });
    const item = await scene.submit(scene.viewer);

    const response = await scene.action(scene.member, item.id, "accept", {
      status: "in-progress",
    });
    expect(response.status).toBe(200);
    const accepted = await body(response);
    expect(accepted).toMatchObject({
      status: "accepted",
      triagedBy: { id: scene.member.id },
      task: {
        status: "in-progress",
        columnId: scene.columns.inProgress.id,
        columnName: "In Progress",
        group: "started",
      },
    });
    expect(accepted.triagedAt).not.toBeNull();
    expect(await taskRow(item.taskId)).toMatchObject({
      status: "in-progress",
      columnId: scene.columns.inProgress.id,
      position: 3,
      completedAt: null,
    });

    await settle();
    const created = publishedEvents("task.created");
    expect(created).toHaveLength(1);
    expect(created[0]?.data).toMatchObject({
      taskId: item.taskId,
      projectId: scene.project.id,
      currentUserId: scene.member.id,
      status: "in-progress",
      type: "created",
      source: "intake",
    });
    expect(publishedEvents("intake.item_updated")[0]?.data).toMatchObject({
      action: "accepted",
      previousStatus: "pending",
      status: "accepted",
      columnName: "In Progress",
      columnSlug: "in-progress",
      submittedBy: scene.viewer.id,
    });

    const board = await scene.as(scene.member)(
      `/task/tasks/${scene.project.id}`,
    );
    const columns = (
      (await board.json()) as {
        data: {
          columns: Array<{ slug: string; tasks: Array<{ id: string }> }>;
        };
      }
    ).data.columns;
    const inProgress = columns.find((c) => c.slug === "in-progress");
    expect(inProgress?.tasks.map((t) => t.id)).toContain(item.taskId);

    // Intake writes the history; no second "created" row.
    const [row] = await settledActivity(item.taskId, "intake_accepted");
    expect(row).toMatchObject({
      userId: scene.member.id,
      eventData: { columnName: "In Progress", status: "in-progress" },
    });
    expect(
      (await activityTypes(item.taskId)).some((r) => r.type === "created"),
    ).toBe(false);
  });

  it("stamps completedAt in a completed column and supports the backlog", async () => {
    const scene = await intakeScene();
    const done = await scene.submit(scene.viewer);
    expect(
      (await scene.action(scene.member, done.id, "accept", { status: "done" }))
        .status,
    ).toBe(200);
    expect((await taskRow(done.taskId))?.completedAt).not.toBeNull();

    const planned = await scene.submit(scene.viewer);
    const response = await scene.action(scene.member, planned.id, "accept", {
      status: "planned",
    });
    expect(response.status).toBe(200);
    expect((await body(response)).task).toMatchObject({
      status: "planned",
      columnId: null,
      columnName: null,
      group: "backlog",
    });
    expect(await taskRow(planned.taskId)).toMatchObject({
      status: "planned",
      columnId: null,
      completedAt: null,
    });
  });

  it("refuses archived, unknown and triage targets", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const archived = await scene.action(scene.member, item.id, "accept", {
      status: "archived",
    });
    expect(archived.status).toBe(400);
    expect(await archived.text()).toBe("Choose a column or the backlog");
    for (const status of ["nope", item.task.status]) {
      const response = await scene.action(scene.member, item.id, "accept", {
        status,
      });
      expect(response.status, status).toBe(400);
      expect(await response.text()).toBe("Column not found");
    }
    expect((await intakeRow(item.id))?.status).toBe("pending");
  });

  it("accepts once, even when two triagers race", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await scene.action(scene.member, item.id, "accept", { status: "to-do" });
    const again = await scene.action(scene.member, item.id, "accept", {
      status: "to-do",
    });
    expect(again.status).toBe(409);
    expect(await again.text()).toBe("This request was already accepted");

    const racing = await scene.submit(scene.viewer);
    const { mockAuthenticatedSession } = await import("./helpers/auth");
    mockAuthenticatedSession(scene.member);
    const request = () =>
      scene.app.request(`/api/intake/item/${racing.id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "to-do" }),
      });
    const statuses = (await Promise.all([request(), request()])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([200, 409]);
    await settle();
    expect(
      publishedEvents("task.created").filter(
        (e) => e.data.taskId === racing.taskId,
      ),
    ).toHaveLength(1);
  });
});

describe("API integration: other triage actions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("declines with a reason and refuses a second decline", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const response = await scene.action(scene.member, item.id, "decline", {
      note: "  Out of scope  ",
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      status: "declined",
      resolutionNote: "Out of scope",
      task: { group: "triage" },
    });
    const again = await scene.action(scene.member, item.id, "decline");
    expect(again.status).toBe(409);
    expect(await again.text()).toBe("Reopen this request first");
    const [row] = await settledActivity(item.taskId, "intake_declined");
    expect(row?.eventData).toEqual({ note: "Out of scope" });
  });

  it("snoozes within bounds, changes the date and unsnoozes", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    for (const [until, message] of [
      [
        new Date(Date.now() - 60_000).toISOString(),
        "Pick a time in the future",
      ],
      [inFuture(30_000), "Pick a time in the future"],
      [inFuture(367 * DAY_MS), "You can snooze for up to a year"],
      ["2026-10-01T00:00:00", "Pick a valid date"],
    ] as const) {
      const response = await scene.action(scene.member, item.id, "snooze", {
        until,
      });
      expect(response.status, until).toBe(400);
      expect(await response.text()).toBe(message);
    }

    const first = inFuture(2 * DAY_MS);
    const snoozed = await body(
      await scene.action(scene.member, item.id, "snooze", { until: first }),
    );
    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.snoozedUntil).toBe(first);
    const second = inFuture(5 * DAY_MS);
    const changed = await body(
      await scene.action(scene.member, item.id, "snooze", { until: second }),
    );
    expect(changed.snoozedUntil).toBe(second);

    const woken = await body(
      await scene.action(scene.member, item.id, "unsnooze"),
    );
    expect(woken).toMatchObject({ status: "pending", snoozedUntil: null });
    const again = await scene.action(scene.member, item.id, "unsnooze");
    expect(again.status).toBe(409);
    expect(await again.text()).toBe("This request isn't snoozed");

    await settledActivity(item.taskId, "intake_snoozed", 2);
    await settledActivity(item.taskId, "intake_unsnoozed");
  });

  it("reads an expired snooze as pending everywhere", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await db
      .update(schema.intakeItemTable)
      .set({ status: "snoozed", snoozedUntil: new Date(Date.now() - 60_000) })
      .where(eq(schema.intakeItemTable.id, item.id));

    const list = await scene.list(scene.member);
    expect(list.items.map((i) => i.id)).toEqual([item.id]);
    expect(list.items[0]).toMatchObject({
      status: "pending",
      snoozedUntil: null,
    });
    expect(list.counts).toMatchObject({ pending: 1, snoozed: 0 });
    expect(
      (await scene.list(scene.member, "status=snoozed")).items,
    ).toHaveLength(0);
    const get = await scene.as(scene.member)(`/intake/item/${item.id}`);
    expect((await body(get)).status).toBe("pending");
    const summary = await scene.as(scene.member)(
      `/intake/project/${scene.project.id}/summary`,
    );
    expect(await summary.json()).toEqual({ pending: 1, snoozed: 0 });

    // An expired snooze isn't snoozed any more, and can be accepted.
    expect((await scene.action(scene.member, item.id, "unsnooze")).status).toBe(
      409,
    );
    const accepted = await scene.action(scene.member, item.id, "accept", {
      status: "to-do",
    });
    expect(accepted.status).toBe(200);
  });

  it("marks duplicates of visible tasks of the same project only", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const target = await scene.createBoardTask({ title: "Existing work" });
    const other = await scene.submit(scene.viewer);
    const archived = await scene.createBoardTask({ archivedAt: new Date() });
    const elsewhere = await (async () => {
      const { createProjectFixture } = await import("./helpers/fixtures");
      const { project } = await createProjectFixture({
        workspaceId: scene.workspace.id,
        slug: "api",
      });
      return scene.createBoardTask({ projectId: project.id });
    })();

    const duplicate = (duplicateOfTaskId: string, note?: string) =>
      scene.action(scene.member, item.id, "duplicate", {
        duplicateOfTaskId,
        ...(note === undefined ? {} : { note }),
      });

    const self = await duplicate(item.taskId);
    expect(self.status).toBe(400);
    expect(await self.text()).toBe("A request can't duplicate itself");
    for (const invisible of [other.taskId, archived.id]) {
      const response = await duplicate(invisible);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Pick a task from this project's board or backlog",
      );
    }
    for (const missing of [elsewhere.id, "unknown-task"]) {
      const response = await duplicate(missing);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Task not found");
    }

    const marked = await duplicate(target.id, "Same as the existing one");
    expect(marked.status).toBe(200);
    expect(await body(marked)).toMatchObject({
      status: "duplicate",
      resolutionNote: "Same as the existing one",
      duplicateOf: {
        taskId: target.id,
        key: `WEB-${target.number}`,
        title: "Existing work",
        status: "to-do",
      },
    });
    const [row] = await settledActivity(item.taskId, "intake_duplicate");
    expect(row?.eventData).toMatchObject({
      duplicateOfTaskId: target.id,
      duplicateKey: `WEB-${target.number}`,
      duplicateTitle: "Existing work",
    });

    // Deleting the target keeps the status and drops the link.
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, target.id));
    const after = await scene.as(scene.member)(`/intake/item/${item.id}`);
    expect(await body(after)).toMatchObject({
      status: "duplicate",
      duplicateOf: null,
    });
  });

  it("reopens closed requests and refuses everything on accepted ones", async () => {
    const scene = await intakeScene();
    const declined = await scene.submit(scene.viewer);
    await scene.action(scene.member, declined.id, "decline", { note: "No" });
    const reopened = await body(
      await scene.action(scene.member, declined.id, "reopen"),
    );
    expect(reopened).toMatchObject({ status: "pending", resolutionNote: null });
    const pendingReopen = await scene.action(
      scene.member,
      declined.id,
      "reopen",
    );
    expect(pendingReopen.status).toBe(409);
    expect(await pendingReopen.text()).toBe("This request is already open");

    const target = await scene.createBoardTask();
    const dup = await scene.submit(scene.viewer);
    await scene.action(scene.member, dup.id, "duplicate", {
      duplicateOfTaskId: target.id,
    });
    expect(
      await body(await scene.action(scene.member, dup.id, "reopen")),
    ).toMatchObject({ status: "pending", duplicateOf: null });
    await settledActivity(dup.taskId, "intake_reopened");

    const accepted = await scene.submit(scene.viewer);
    await scene.action(scene.member, accepted.id, "accept", {
      status: "to-do",
    });
    for (const [name, payload] of [
      ["accept", { status: "to-do" }],
      ["decline", {}],
      ["snooze", { until: inFuture(DAY_MS) }],
      ["unsnooze", undefined],
      ["duplicate", { duplicateOfTaskId: target.id }],
      ["reopen", undefined],
    ] as const) {
      const response = await scene.action(
        scene.member,
        accepted.id,
        name,
        payload,
      );
      expect(response.status, name).toBe(409);
      expect(await response.text()).toBe("This request was already accepted");
    }
  });
});

describe("API integration: requester notifications", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function outcomes(userId: string, count: number) {
    await settle(300);
    const rows = (await notificationsFor(userId)).filter((row) =>
      row.type.startsWith("intake_"),
    );
    expect(rows).toHaveLength(count);
    return rows;
  }

  it("notifies the requester of accept, decline and duplicate only", async () => {
    const scene = await intakeScene();
    const accepted = await scene.submit(scene.viewer, { title: "Dark mode" });
    const declined = await scene.submit(scene.viewer, { title: "Faxes" });
    const duplicate = await scene.submit(scene.viewer, { title: "Search" });
    const snoozed = await scene.submit(scene.viewer, { title: "Later" });
    const target = await scene.createBoardTask({ title: "Search v2" });

    await scene.action(scene.member, accepted.id, "accept", {
      status: "to-do",
    });
    await scene.action(scene.member, declined.id, "decline", {
      note: "Not now",
    });
    await scene.action(scene.member, duplicate.id, "duplicate", {
      duplicateOfTaskId: target.id,
    });
    await scene.action(scene.member, snoozed.id, "snooze", {
      until: inFuture(DAY_MS),
    });
    await scene.action(scene.member, declined.id, "reopen");

    const rows = await outcomes(scene.viewer.id, 3);
    const byType = Object.fromEntries(rows.map((row) => [row.type, row]));
    expect(byType.intake_accepted).toMatchObject({
      title: "Your request was accepted",
      content: `${accepted.task.key} "Dark mode" is now on the board in To Do.`,
      resourceId: accepted.taskId,
      resourceType: "task",
      workspaceId: scene.workspace.id,
      actorId: scene.member.id,
      eventData: {
        intakeItemId: accepted.id,
        taskKey: accepted.task.key,
        columnName: "To Do",
      },
    });
    expect(byType.intake_declined).toMatchObject({
      title: "Your request was declined",
      content: '"Faxes" was declined. Reason: Not now',
      eventData: { note: "Not now", intakeItemId: declined.id },
    });
    expect(byType.intake_duplicate).toMatchObject({
      title: "Your request is a duplicate",
      content: `"Search" is already covered by WEB-${target.number} "Search v2".`,
      eventData: {
        duplicateTaskId: target.id,
        duplicateKey: `WEB-${target.number}`,
      },
    });
  });

  it("says nothing to requesters who triage their own request", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.member);
    await scene.action(scene.member, item.id, "decline");
    await outcomes(scene.member.id, 0);
  });

  it("respects the status-change preference and membership", async () => {
    const scene = await intakeScene();
    const quiet = await scene.submit(scene.viewer);
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: scene.viewer.id,
      taskStatusChangeEnabled: false,
    });
    await scene.action(scene.member, quiet.id, "decline");
    await outcomes(scene.viewer.id, 0);

    const leaver = await scene.submit(scene.admin);
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, scene.workspace.id),
          eq(schema.workspaceUserTable.userId, scene.admin.id),
        ),
      );
    await scene.action(scene.member, leaver.id, "decline");
    await outcomes(scene.admin.id, 0);
  });
});
