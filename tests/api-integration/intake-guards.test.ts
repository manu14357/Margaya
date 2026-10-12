import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { checkDueDateReminders } from "../../apps/api/src/scheduler/due-date-reminders";
import { resetTestDatabase } from "./helpers/database";
import { assignTask, createProjectFixture } from "./helpers/fixtures";
import {
  type IntakeItemJson,
  intakeScene,
  json,
  notificationsFor,
  taskRow,
} from "./helpers/intake";

const GUARD =
  "This task is waiting in intake. Accept it from the Intake tab to put it on the board.";
const BULK_GUARD = "Some of these tasks are waiting in intake.";

type Scene = Awaited<ReturnType<typeof intakeScene>>;

/** A pending, a declined and a duplicate request: all still in triage. */
async function requestsInTriage(scene: Scene) {
  const target = await scene.createBoardTask();
  const pending = await scene.submit(scene.viewer, { title: "Pending one" });
  const declined = await scene.submit(scene.viewer, { title: "Declined one" });
  const duplicate = await scene.submit(scene.viewer, {
    title: "Duplicate one",
  });
  await scene.action(scene.member, declined.id, "decline");
  await scene.action(scene.member, duplicate.id, "duplicate", {
    duplicateOfTaskId: target.id,
  });
  return { target, requests: [pending, declined, duplicate] };
}

async function fullUpdate(
  scene: Scene,
  item: IntakeItemJson,
  changes: Record<string, unknown>,
) {
  const task = await taskRow(item.taskId);
  return scene.as(scene.admin)(
    `/task/${item.taskId}`,
    json("PUT", {
      title: task?.title,
      description: task?.description ?? "",
      priority: task?.priority,
      status: task?.status,
      projectId: task?.projectId,
      position: task?.position ?? 0,
      ...changes,
    }),
  );
}

describe("API integration: intake task guards", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses every ordinary way out of triage", async () => {
    const scene = await intakeScene();
    const { project: other } = await createProjectFixture({
      workspaceId: scene.workspace.id,
      slug: "ops",
    });
    const { requests } = await requestsInTriage(scene);
    const admin = scene.as(scene.admin);

    for (const item of requests) {
      const attempts: Array<[string, Response]> = [
        [
          "status",
          await admin(
            `/task/status/${item.taskId}`,
            json("PUT", { status: "to-do" }),
          ),
        ],
        [
          "legacy archive",
          await admin(
            `/task/status/${item.taskId}`,
            json("PUT", { status: "archived" }),
          ),
        ],
        ["full update", await fullUpdate(scene, item, { status: "done" })],
        [
          "archive",
          await admin(`/task/archive/${item.taskId}`, { method: "POST" }),
        ],
        [
          "move",
          await admin(
            `/task/move/${item.taskId}`,
            json("PUT", { destinationProjectId: other.id }),
          ),
        ],
      ];
      for (const [name, response] of attempts) {
        expect(response.status, `${item.task.title}: ${name}`).toBe(409);
        expect(await response.text()).toBe(GUARD);
      }
      const task = await taskRow(item.taskId);
      expect(task).toMatchObject({
        status: item.task.status,
        projectId: scene.project.id,
        archivedAt: null,
      });
    }
  });

  it("guards bulk status and archive changes that include triage tasks", async () => {
    const scene = await intakeScene();
    const { target, requests } = await requestsInTriage(scene);
    const [pending] = requests;
    const bulk = (body: Record<string, unknown>) =>
      scene.as(scene.admin)("/task/bulk", json("PATCH", body));

    for (const body of [
      { operation: "updateStatus", value: "done" },
      { operation: "updateStatus", value: "archived" },
      { operation: "archive" },
    ]) {
      const response = await bulk({
        taskIds: [target.id, pending?.taskId],
        ...body,
      });
      expect(response.status, JSON.stringify(body)).toBe(409);
      expect(await response.text()).toBe(BULK_GUARD);
    }
    const single = await bulk({
      taskIds: [pending?.taskId],
      operation: "updateStatus",
      value: "done",
    });
    expect(single.status).toBe(409);
    expect(await single.text()).toBe(BULK_GUARD);
    expect((await taskRow(target.id))?.status).toBe("to-do");

    // Board tasks alone are unaffected, and other bulk edits still work.
    const boardOnly = await bulk({
      taskIds: [target.id],
      operation: "updateStatus",
      value: "done",
    });
    expect(boardOnly.status).toBe(200);
    const priority = await bulk({
      taskIds: [target.id, pending?.taskId],
      operation: "updatePriority",
      value: "high",
    });
    expect(priority.status).toBe(200);
    expect((await taskRow(pending?.taskId ?? ""))?.priority).toBe("high");
  });

  it("keeps field edits, comments and echoing full updates working", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const admin = scene.as(scene.admin);

    const results: Array<[string, Response]> = [
      [
        "title",
        await admin(
          `/task/title/${item.taskId}`,
          json("PUT", { title: "Renamed" }),
        ),
      ],
      [
        "priority",
        await admin(
          `/task/priority/${item.taskId}`,
          json("PUT", { priority: "urgent" }),
        ),
      ],
      [
        "assignee",
        await admin(
          `/task/assignee/${item.taskId}`,
          json("PUT", { userId: scene.member.id }),
        ),
      ],
      [
        "due date",
        await admin(
          `/task/due-date/${item.taskId}`,
          json("PUT", { dueDate: "2026-12-01T00:00:00.000Z" }),
        ),
      ],
      [
        "label",
        await admin(
          "/label",
          json("POST", {
            name: "ux",
            color: "#ff0000",
            workspaceId: scene.workspace.id,
            taskId: item.taskId,
          }),
        ),
      ],
      [
        "comment",
        await admin(`/comment/${item.taskId}`, json("POST", { content: "Hi" })),
      ],
      [
        "full update echo",
        // Echoing the first assignee keeps the assignees.
        await fullUpdate(scene, item, {
          title: "Renamed again",
          userId: scene.member.id,
        }),
      ],
    ];
    for (const [name, response] of results) {
      expect(response.status, `${name}: ${await response.clone().text()}`).toBe(
        200,
      );
    }
    expect(await taskRow(item.taskId)).toMatchObject({
      title: "Renamed again",
      priority: "urgent",
      status: item.task.status,
      userId: scene.member.id,
    });
  });

  it("keeps triage tasks out of search, export and the column API", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer, {
      title: "Zebra stripes please",
    });
    const board = await scene.createBoardTask({ title: "Zebra board task" });
    const admin = scene.as(scene.admin);

    const search = await admin(
      `/search?${new URLSearchParams({ q: "zebra", workspaceId: scene.workspace.id, type: "tasks" })}`,
    );
    expect(search.status).toBe(200);
    const results = (await search.json()) as {
      results: Array<{ id: string; type: string }>;
    };
    const ids = results.results
      .filter((r) => r.type === "task")
      .map((r) => r.id);
    expect(ids).toContain(board.id);
    expect(ids).not.toContain(item.taskId);

    const byKey = await admin(
      `/search?${new URLSearchParams({ q: item.task.key, workspaceId: scene.workspace.id, type: "tasks" })}`,
    );
    const keyResults = (await byKey.json()) as {
      results: Array<{ id: string }>;
    };
    expect(keyResults.results.map((r) => r.id)).not.toContain(item.taskId);

    const exported = await admin(`/task/export/${scene.project.id}`);
    expect(exported.status).toBe(200);
    const exportedTitles = (
      (await exported.json()) as { tasks: Array<{ title: string }> }
    ).tasks.map((t) => t.title);
    expect(exportedTitles).toContain("Zebra board task");
    expect(exportedTitles).not.toContain("Zebra stripes please");

    const [triageColumn] = await db
      .select()
      .from(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, scene.project.id),
          eq(schema.columnTable.group, "triage"),
        ),
      );
    const columns = await admin(`/column/${scene.project.id}`);
    expect(
      ((await columns.json()) as Array<{ id: string }>).map((c) => c.id),
    ).not.toContain(triageColumn?.id);
    const rename = await admin(
      `/column/${triageColumn?.id}`,
      json("PUT", { name: "Inbox" }),
    );
    expect(rename.status).toBe(400);
    const remove = await admin(`/column/${triageColumn?.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(400);
  });

  it("sends no due-date reminders for triage tasks", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const board = await scene.createBoardTask();
    const overdue = new Date(Date.now() - 2 * 60 * 1000);
    for (const taskId of [item.taskId, board.id]) {
      await db
        .update(schema.taskTable)
        .set({ dueDate: overdue })
        .where(eq(schema.taskTable.id, taskId));
      await assignTask(taskId, [scene.member.id]);
    }

    await checkDueDateReminders();
    const reminders = (await notificationsFor(scene.member.id)).filter(
      (row) => row.type === "task_overdue",
    );
    expect(reminders.map((row) => row.resourceId)).toEqual([board.id]);
  });
});
