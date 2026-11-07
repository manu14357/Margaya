import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { runTrashPurge } from "../../apps/api/src/trash/purge-job";
import { trashRetentionDays } from "../../apps/api/src/trash/settings";
import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from "../../apps/api/src/webhook/dispatch/dispatcher";
import { settleWebhookEnqueues } from "../../apps/api/src/webhook/dispatch/enqueue";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";
import { ALL_ON, resetPublicBoardState } from "./helpers/public-board";
import { type ProjectTrashJson, trashScene } from "./helpers/trash";
import { deliveryRows } from "./helpers/webhooks";

recordEvents("project.deleted", "project.restored", "project.purged");

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
  clearPublishedEvents();
});
afterEach(() => {
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
});
afterAll(() => {
  setPublicBoardInstanceState(null);
  startWebhookDispatcher();
});

async function backdate(taskIds: string[], projectIds: string[], days: number) {
  const when = new Date(Date.now() - days * DAY_MS);
  for (const id of taskIds) {
    await db
      .update(schema.taskTable)
      .set({ deletedAt: when })
      .where(eq(schema.taskTable.id, id));
  }
  for (const id of projectIds) {
    await db
      .update(schema.projectTable)
      .set({ deletedAt: when })
      .where(eq(schema.projectTable.id, id));
  }
}

describe("project trash", () => {
  it("hides a trashed project and its tasks, then restores exactly its batch", async () => {
    const s = await trashScene();
    const projectId = s.web.project.id;
    const live = await s.createTask("Live work");
    const earlier = await s.createTask("Deleted before");
    await s.trash(earlier.id);
    await s.ok(s.ada, "POST", "/favorite", {
      workspaceId: s.workspaceId,
      entityType: "project",
      entityId: projectId,
    });
    const publication = await s.ok<{ linkToken: string }>(
      s.owner,
      "POST",
      `/publication/project/${projectId}/publish`,
      { ...ALL_ON, requestsEnabled: false },
    );

    await s.ok(s.ada, "DELETE", `/project/${projectId}`);

    const projects = await s.ok<Array<{ id: string }>>(
      s.ada,
      "GET",
      `/project?workspaceId=${s.workspaceId}&includeArchived=true`,
    );
    expect(projects.map((project) => project.id)).toEqual([s.api.project.id]);
    expect(
      (
        await s.as(s.ada)(
          "GET",
          `/project/${projectId}?workspaceId=${s.workspaceId}`,
        )
      ).status,
    ).toBe(404);
    expect((await s.as(s.ada)("GET", `/task/tasks/${projectId}`)).status).toBe(
      404,
    );
    expect((await s.as(s.ada)("GET", `/task/${live.id}`)).status).toBe(404);
    expect(await s.queryIds()).toEqual([]);
    expect(
      (await s.searchIds(s.web.project.name)).map((result) => result.id),
    ).not.toContain(projectId);
    const favorites = await s.ok<unknown[]>(
      s.ada,
      "GET",
      `/favorite?workspaceId=${s.workspaceId}`,
    );
    expect(JSON.stringify(favorites)).not.toContain(projectId);
    resetPublicBoardState();
    expect(
      (await s.app.request(`/api/public-board/${publication.linkToken}`))
        .status,
    ).toBe(404);
    // The project's task trash is unreachable while the project is trashed.
    expect(
      (await s.as(s.ada)("GET", `/trash/project/${projectId}/tasks`)).status,
    ).toBe(404);
    // Restoring a task of a trashed project is blocked.
    const blocked = await s.as(s.ada)(
      "POST",
      `/trash/task/${earlier.id}/restore`,
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toContain("Restore the project first");
    // The key stays reserved while the project is in the trash.
    const clash = await s.as(s.ada)("POST", "/project", {
      name: "Again",
      workspaceId: s.workspaceId,
      icon: "Layout",
      slug: s.web.project.slug,
    });
    expect(clash.status).toBe(409);

    const listed = await s.ok<ProjectTrashJson>(
      s.ada,
      "GET",
      `/trash/projects?workspaceId=${s.workspaceId}`,
    );
    expect(listed.items).toEqual([
      expect.objectContaining({
        id: projectId,
        taskCount: 1,
        deletedBy: { id: s.ada.id, name: "Ada" },
      }),
    ]);

    await s.ok(s.ada, "POST", `/trash/projects/${projectId}/restore`);
    expect(await s.boardIds()).toEqual([live.id]);
    expect((await s.list()).items.map((item) => item.id)).toEqual([earlier.id]);
    const after = await s.ok<unknown[]>(
      s.ada,
      "GET",
      `/favorite?workspaceId=${s.workspaceId}`,
    );
    expect(JSON.stringify(after)).toContain(projectId);
    await s.restore(earlier.id);
  });

  it("deletes a trashed project permanently", async () => {
    const s = await trashScene();
    const projectId = s.web.project.id;
    const task = await s.createTask("Gone for good");
    await s.ok(s.ada, "DELETE", `/project/${projectId}`);
    // Only trashed projects can be purged through the trash.
    expect(
      (await s.as(s.ada)("DELETE", `/trash/projects/${s.api.project.id}`))
        .status,
    ).toBe(404);
    await s.ok(s.ada, "DELETE", `/trash/projects/${projectId}`);
    const [row] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId));
    expect(row).toBeUndefined();
    expect(await s.taskRow(task.id)).toBeNull();
    expect(
      publishedEvents().map((event) => [event.name, event.data.projectId]),
    ).toEqual([
      ["project.deleted", projectId],
      ["project.purged", projectId],
    ]);
  });

  it("needs project:delete to delete, restore and delete permanently", async () => {
    const s = await trashScene();
    const projectId = s.web.project.id;
    expect((await s.as(s.mia)("DELETE", `/project/${projectId}`)).status).toBe(
      403,
    );
    await s.ok(s.ada, "DELETE", `/project/${projectId}`);
    expect(
      (await s.as(s.mia)("POST", `/trash/projects/${projectId}/restore`))
        .status,
    ).toBe(403);
    expect(
      (await s.as(s.mia)("DELETE", `/trash/projects/${projectId}`)).status,
    ).toBe(403);
    expect(
      (await s.as(s.outsider)("POST", `/trash/projects/${projectId}/restore`))
        .status,
    ).toBe(403);
    // Members may read the list.
    expect(
      (await s.as(s.mia)("GET", `/trash/projects?workspaceId=${s.workspaceId}`))
        .status,
    ).toBe(200);
  });

  it("sends webhooks for trash, restore and purge", async () => {
    stopWebhookDispatcher();
    process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    const s = await trashScene();
    const webhook = await s.ok<{ id: string }>(s.ada, "POST", "/webhook", {
      workspaceId: s.workspaceId,
      url: "http://127.0.0.1:9/hook",
      events: ["task.*", "project.*"],
    });
    const task = await s.createTask("Hooked");
    await settleWebhookEnqueues();
    await s.trash(task.id);
    await settleWebhookEnqueues();
    await s.restore(task.id);
    await settleWebhookEnqueues();
    await s.trash(task.id);
    await settleWebhookEnqueues();
    await s.purge(task.id);
    await settleWebhookEnqueues();
    await s.ok(s.ada, "DELETE", `/project/${s.api.project.id}`);
    await settleWebhookEnqueues();
    await s.ok(s.ada, "POST", `/trash/projects/${s.api.project.id}/restore`);
    await settleWebhookEnqueues();
    await s.ok(s.ada, "DELETE", `/project/${s.api.project.id}`);
    await settleWebhookEnqueues();
    await s.ok(s.ada, "DELETE", `/trash/projects/${s.api.project.id}`);
    await settleWebhookEnqueues();

    const events = (await deliveryRows(webhook.id)).map(
      (row) => (JSON.parse(row.body) as { event: string }).event,
    );
    expect(events).toEqual([
      "task.created",
      "task.deleted",
      "task.restored",
      "task.deleted",
      "task.purged",
      "project.deleted",
      "project.restored",
      "project.deleted",
      "project.purged",
    ]);
  });
});

describe("trash auto purge", () => {
  it("reads TRASH_RETENTION_DAYS with a default of 30 and 0 for off", () => {
    expect(trashRetentionDays(undefined)).toBe(30);
    expect(trashRetentionDays("")).toBe(30);
    expect(trashRetentionDays("abc")).toBe(30);
    expect(trashRetentionDays("7")).toBe(7);
    expect(trashRetentionDays("0")).toBe(0);
  });

  it("purges trash older than the retention, and nothing when it is 0", async () => {
    const s = await trashScene();
    const old = await s.createTask("Old");
    const recent = await s.createTask("Recent");
    const inOldProject = await s.createTask("In old project", {
      projectId: s.api.project.id,
    });
    await s.trash(old.id);
    await s.trash(recent.id);
    await s.ok(s.ada, "DELETE", `/project/${s.api.project.id}`);
    await backdate([old.id, inOldProject.id], [s.api.project.id], 31);

    expect(await runTrashPurge(new Date(), undefined, 0)).toEqual({
      degraded: false,
      projects: 0,
      tasks: 0,
      pages: 0,
    });
    expect(await s.taskRow(old.id)).not.toBeNull();

    const outcome = await runTrashPurge(new Date(), undefined, 30);
    expect(outcome).toEqual({
      degraded: false,
      projects: 1,
      tasks: 1,
      pages: 0,
    });
    expect(await s.taskRow(old.id)).toBeNull();
    expect(await s.taskRow(inOldProject.id)).toBeNull();
    expect(await s.taskRow(recent.id)).not.toBeNull();

    // A longer retention keeps the rest.
    await backdate([recent.id], [], 10);
    expect((await runTrashPurge(new Date(), undefined, 30)).tasks).toBe(0);
    expect(await s.taskRow(recent.id)).not.toBeNull();
  });
});
