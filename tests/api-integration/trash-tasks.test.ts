import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";
import { ALL_ON, resetPublicBoardState } from "./helpers/public-board";
import { callMcpTool, trashScene } from "./helpers/trash";

recordEvents("task.deleted", "task.restored", "task.purged");

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
  clearPublishedEvents();
});
afterAll(() => setPublicBoardInstanceState(null));

describe("task trash", () => {
  it("hides a trashed task everywhere: detail, board, query, my work, search and the public board", async () => {
    const s = await trashScene();
    const kept = await s.createTask("Keep the lights on");
    const gone = await s.createTask("Lighthouse cleanup");
    await db.insert(schema.activityTable).values({
      taskId: gone.id,
      type: "comment",
      userId: s.ada.id,
      content: "Lighthouse notes",
    });
    const publication = await s.ok<{ linkToken: string }>(
      s.owner,
      "POST",
      `/publication/project/${s.web.project.id}/publish`,
      { ...ALL_ON, requestsEnabled: false },
    );

    expect(await s.queryIds()).toEqual(
      expect.arrayContaining([kept.id, gone.id]),
    );

    const trashed = await s.trash(gone.id);
    expect(trashed.id).toBe(gone.id);
    const row = await s.taskRow(gone.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedBy).toBe(s.ada.id);
    expect(row?.trashBatchId).toBe(gone.id);

    // Detail and every task-scoped route answer 404.
    expect((await s.as(s.ada)("GET", `/task/${gone.id}`)).status).toBe(404);
    expect(
      (
        await s.as(s.ada)(
          "GET",
          `/task/${gone.id}?workspaceId=${s.workspaceId}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await s.as(s.ada)("PUT", `/task/title/${gone.id}`, { title: "x" }))
        .status,
    ).toBe(404);
    // Deleting again is a 404 too.
    expect((await s.as(s.ada)("DELETE", `/task/${gone.id}`)).status).toBe(404);

    expect(await s.boardIds()).toEqual([kept.id]);
    expect(await s.queryIds()).toEqual([kept.id]);
    expect(await s.queryIds({ archived: "include" })).toEqual([kept.id]);
    const myWork = await s.queryIds({
      filters: { key: "assignee", operator: "in", values: ["me"] },
    });
    expect(myWork).toEqual([kept.id]);
    const found = await s.searchIds("Lighthouse");
    expect(found.filter((result) => result.type === "task")).toEqual([]);
    expect(found.filter((result) => result.type === "comment")).toEqual([]);

    resetPublicBoardState();
    const board = await s.app.request(
      `/api/public-board/${publication.linkToken}/tasks`,
    );
    expect(board.status).toBe(200);
    const boardText = await board.text();
    expect(boardText).toContain(kept.id);
    expect(boardText).not.toContain(gone.id);
    const publicTask = await s.app.request(
      `/api/public-board/${publication.linkToken}/tasks/${gone.number}`,
    );
    expect(publicTask.status).toBe(404);
  });

  it("hides a trashed task from MCP tools and restores it with restore_task", async () => {
    const s = await trashScene();
    const task = await s.createTask("Secret plan");
    await s.trash(task.id);

    const read = await callMcpTool(s.app, s.ada.id, "get_task", {
      taskId: task.id,
    });
    expect(read.isError).toBe(true);
    expect(read.text).not.toContain("Secret plan");

    const restored = await callMcpTool(s.app, s.ada.id, "restore_task", {
      taskId: task.id,
    });
    expect(restored.isError, restored.text).toBe(false);
    expect((await s.taskRow(task.id))?.deletedAt).toBeNull();
  });

  it("restores a task into its column with comments, relations and time entries intact", async () => {
    const s = await trashScene();
    const task = await s.createTask("Ship it", { status: "in-progress" });
    const other = await s.createTask("Other");
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "comment",
      userId: s.ada.id,
      content: "Keep me",
    });
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: task.id,
      targetTaskId: other.id,
      relationType: "blocks",
    });
    await db.insert(schema.timeEntryTable).values({
      taskId: task.id,
      userId: s.ada.id,
      startTime: new Date(),
      duration: 60,
    });

    await s.trash(task.id);
    // The other task no longer lists the hidden relation.
    const relations = await s.ok<unknown[]>(
      s.ada,
      "GET",
      `/task-relation/${other.id}`,
    );
    expect(relations).toEqual([]);

    const restored = await s.restore(task.id);
    expect(restored.status).toBe("in-progress");
    // History rows are written by event subscribers, after the response.
    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.taskId, task.id));
      expect(rows.map((row) => row.type)).toEqual(
        expect.arrayContaining(["comment", "deleted", "restored"]),
      );
      expect(rows.some((row) => row.content === "Keep me")).toBe(true);
    });
    expect(
      await s.ok<unknown[]>(s.ada, "GET", `/task-relation/${other.id}`),
    ).toHaveLength(1);
    const entries = await db
      .select()
      .from(schema.timeEntryTable)
      .where(eq(schema.timeEntryTable.taskId, task.id));
    expect(entries).toHaveLength(1);
    expect(await s.boardIds()).toEqual(
      expect.arrayContaining([task.id, other.id]),
    );
  });

  it("trashes and restores sub-tasks as one batch, leaving earlier deletes in the trash", async () => {
    const s = await trashScene();
    const parent = await s.createTask("Parent");
    const child = await s.createTask("Child");
    const grandchild = await s.createTask("Grandchild");
    const earlier = await s.createTask("Deleted earlier");
    await s.makeSubtask(parent.id, child.id);
    await s.makeSubtask(child.id, grandchild.id);
    await s.makeSubtask(parent.id, earlier.id);

    await s.trash(earlier.id);
    await s.trash(parent.id);
    for (const id of [parent.id, child.id, grandchild.id]) {
      expect((await s.taskRow(id))?.trashBatchId).toBe(parent.id);
    }
    expect((await s.taskRow(earlier.id))?.trashBatchId).toBe(earlier.id);

    const listed = await s.list();
    expect(listed.items.map((item) => item.id)).toEqual([
      parent.id,
      earlier.id,
    ]);
    expect(listed.items[0]?.subTaskCount).toBe(2);
    expect(listed.items[0]?.deletedBy).toEqual({ id: s.ada.id, name: "Ada" });

    // A sub-task deleted with its parent is restored through the parent.
    const blocked = await s.as(s.ada)(
      "POST",
      `/trash/task/${child.id}/restore`,
    );
    expect(blocked.status).toBe(409);

    await s.restore(parent.id);
    for (const id of [parent.id, child.id, grandchild.id]) {
      expect((await s.taskRow(id))?.deletedAt).toBeNull();
    }
    expect((await s.taskRow(earlier.id))?.deletedAt).not.toBeNull();
    expect((await s.list()).items.map((item) => item.id)).toEqual([earlier.id]);
  });

  it("bulk delete trashes the tasks", async () => {
    const s = await trashScene();
    const a = await s.createTask("A");
    const b = await s.createTask("B");
    const result = await s.ok<{ updatedCount: number }>(
      s.ada,
      "PATCH",
      "/task/bulk",
      {
        taskIds: [a.id, b.id],
        operation: "delete",
      },
    );
    expect(result.updatedCount).toBe(2);
    expect((await s.taskRow(a.id))?.deletedAt).not.toBeNull();
    expect((await s.taskRow(b.id))?.deletedAt).not.toBeNull();
    expect((await s.list()).total).toBe(2);
  });

  it("restores into the entry column when the task's column is gone", async () => {
    const s = await trashScene();
    const task = await s.createTask("Reviewed", { status: "in-review" });
    await s.trash(task.id);
    // The trashed task does not block deleting its column.
    const deleted = await s.as(s.ada)(
      "DELETE",
      `/column/${s.web.columns.inReview.id}`,
    );
    expect(deleted.status, await deleted.clone().text()).toBe(200);

    const restored = await s.restore(task.id);
    expect(restored.status).toBe("to-do");
    expect((await s.taskRow(task.id))?.columnId).toBe(s.web.columns.todo.id);
  });

  it("searches the trash by title and key", async () => {
    const s = await trashScene();
    const alpha = await s.createTask("Alpha task");
    const beta = await s.createTask("Beta task");
    await s.trash(alpha.id);
    await s.trash(beta.id);
    expect(
      (await s.list(undefined, "?search=alpha")).items.map((item) => item.id),
    ).toEqual([alpha.id]);
    expect(
      (await s.list(undefined, `?search=web-${beta.number}`)).items.map(
        (item) => item.id,
      ),
    ).toEqual([beta.id]);
  });

  it("deletes permanently, empties the trash and never reuses a task number", async () => {
    const s = await trashScene();
    const parent = await s.createTask("Parent");
    const child = await s.createTask("Child");
    const other = await s.createTask("Other");
    await s.makeSubtask(parent.id, child.id);
    await s.trash(parent.id);
    await s.trash(other.id);

    await s.purge(parent.id);
    expect(await s.taskRow(parent.id)).toBeNull();
    expect(await s.taskRow(child.id)).toBeNull();
    expect(await s.taskRow(other.id)).not.toBeNull();
    // Live tasks can't be purged through the trash route.
    const live = await s.createTask("Live");
    expect((await s.as(s.ada)("DELETE", `/trash/task/${live.id}`)).status).toBe(
      404,
    );

    const emptied = await s.ok<{ deletedCount: number }>(
      s.ada,
      "POST",
      `/trash/project/${s.web.project.id}/empty`,
    );
    expect(emptied.deletedCount).toBe(1);
    expect((await s.list()).total).toBe(0);

    const next = await s.createTask("After purge");
    expect(next.number).toBe(5);
    expect(next.number).toBeGreaterThan(other.number);
  });

  it("needs task:delete to delete, restore and delete permanently", async () => {
    const s = await trashScene();
    const task = await s.createTask("Guarded");
    expect((await s.as(s.mia)("DELETE", `/task/${task.id}`)).status).toBe(403);
    await s.trash(task.id);
    expect(
      (await s.as(s.mia)("POST", `/trash/task/${task.id}/restore`)).status,
    ).toBe(403);
    expect((await s.as(s.mia)("DELETE", `/trash/task/${task.id}`)).status).toBe(
      403,
    );
    expect(
      (await s.as(s.mia)("POST", `/trash/project/${s.web.project.id}/empty`))
        .status,
    ).toBe(403);
    // Members may read the trash list.
    expect(
      (await s.as(s.mia)("GET", `/trash/project/${s.web.project.id}/tasks`))
        .status,
    ).toBe(200);
    // Outsiders can't see it at all.
    expect(
      (await s.as(s.outsider)("POST", `/trash/task/${task.id}/restore`)).status,
    ).toBe(403);
  });

  it("publishes task.deleted, task.restored and task.purged", async () => {
    const s = await trashScene();
    const parent = await s.createTask("Parent");
    const child = await s.createTask("Child");
    await s.makeSubtask(parent.id, child.id);
    clearPublishedEvents();

    await s.trash(parent.id);
    expect(
      publishedEvents("task.deleted").map((event) => event.data.taskId),
    ).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(publishedEvents("task.deleted")[0]?.data).toMatchObject({
      projectId: s.web.project.id,
      userId: s.ada.id,
      trashBatchId: parent.id,
    });

    await s.restore(parent.id);
    expect(
      publishedEvents("task.restored").map((event) => event.data.taskId),
    ).toEqual(expect.arrayContaining([parent.id, child.id]));

    await s.trash(parent.id);
    await s.purge(parent.id);
    expect(
      publishedEvents("task.purged").map((event) => event.data.taskId),
    ).toEqual(expect.arrayContaining([parent.id, child.id]));
  });
});
