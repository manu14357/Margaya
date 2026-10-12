import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Status changes fan out notifications in the background; keep them from
// racing the next test's TRUNCATE.
vi.mock(
  "../../apps/api/src/notification/controllers/create-notification",
  () => ({ default: vi.fn(async () => null) }),
);

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function context() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const fixture = await createProjectFixture({
    workspaceId: owner.workspace.id,
    slug: "cmp",
  });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  return { ...owner, ...fixture, app };
}

async function seedTask(projectId: string, status: string, number = 1) {
  // Seeded numbers stay clear of the ones the API claims from the project's
  // counter, which direct inserts do not advance.
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Task ${number}`,
      status,
      number: 1000 + number,
    })
    .returning();
  return task;
}

async function completedAt(taskId: string) {
  const [task] = await db
    .select({ completedAt: schema.taskTable.completedAt })
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return task?.completedAt ?? null;
}

describe("API integration: task completion time", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("sets, keeps and clears completedAt through status changes", async () => {
    const { app, project } = await context();
    const shipped = await app.request(
      `/api/column/${project.id}`,
      json("POST", { name: "Shipped", group: "completed" }),
    );
    expect(shipped.status).toBe(200);
    const task = await seedTask(project.id, "to-do");
    const setStatus = (status: string) =>
      app.request(`/api/task/status/${task.id}`, json("PUT", { status }));

    expect((await setStatus("done")).status).toBe(200);
    const first = await completedAt(task.id);
    expect(first).toBeInstanceOf(Date);

    await setStatus("shipped");
    expect(await completedAt(task.id)).toEqual(first);

    await setStatus("in-progress");
    expect(await completedAt(task.id)).toBeNull();

    await setStatus("done");
    const second = await completedAt(task.id);
    expect(second).toBeInstanceOf(Date);

    await setStatus("archived");
    expect(await completedAt(task.id)).toEqual(second);

    await setStatus("planned");
    expect(await completedAt(task.id)).toBeNull();
  });

  it("stores the completion time as UTC like other timestamps", async () => {
    const { app, project } = await context();
    const task = await seedTask(project.id, "to-do");
    const before = Date.now();

    await app.request(
      `/api/task/status/${task.id}`,
      json("PUT", { status: "done" }),
    );

    const stamped = (await completedAt(task.id))?.getTime() ?? 0;
    expect(Math.abs(stamped - before)).toBeLessThan(60_000);
  });

  it("leaves an open task uncompleted when archived", async () => {
    const { app, project } = await context();
    const task = await seedTask(project.id, "to-do");

    await app.request(
      `/api/task/status/${task.id}`,
      json("PUT", { status: "archived" }),
    );

    expect(await completedAt(task.id)).toBeNull();
  });

  it("applies to full updates, creates, bulk updates, moves and imports", async () => {
    const { app, project, workspace } = await context();

    const created = await app.request(
      `/api/task/${project.id}`,
      json("POST", {
        title: "Born done",
        description: "",
        priority: "low",
        status: "done",
      }),
    );
    expect(created.status).toBe(200);
    const createdTask = (await created.json()) as {
      id: string;
      completedAt: string | null;
    };
    expect(createdTask.completedAt).not.toBeNull();

    const openTask = await seedTask(project.id, "to-do", 2);
    const updated = await app.request(
      `/api/task/${openTask.id}`,
      json("PUT", {
        title: "Updated",
        status: "done",
        priority: "low",
        position: 0,
        projectId: project.id,
      }),
    );
    expect(updated.status).toBe(200);
    expect(await completedAt(openTask.id)).toBeInstanceOf(Date);

    const a = await seedTask(project.id, "to-do", 3);
    const b = await seedTask(project.id, "in-progress", 4);
    const bulkDone = await app.request(
      "/api/task/bulk",
      json("PATCH", {
        taskIds: [a.id, b.id],
        operation: "updateStatus",
        value: "done",
      }),
    );
    expect(bulkDone.status).toBe(200);
    expect(await completedAt(a.id)).toBeInstanceOf(Date);
    expect(await completedAt(b.id)).toBeInstanceOf(Date);

    await app.request(
      "/api/task/bulk",
      json("PATCH", {
        taskIds: [a.id],
        operation: "updateStatus",
        value: "in-review",
      }),
    );
    expect(await completedAt(a.id)).toBeNull();

    const { project: destination } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "dst",
    });
    const moved = await app.request(
      `/api/task/move/${a.id}`,
      json("PUT", {
        destinationProjectId: destination.id,
        destinationStatus: "done",
      }),
    );
    expect(moved.status).toBe(200);
    expect(await completedAt(a.id)).toBeInstanceOf(Date);

    const imported = await app.request(
      `/api/task/import/${project.id}`,
      json("POST", {
        tasks: [
          { title: "Imported done", status: "done" },
          { title: "Imported open", status: "to-do" },
        ],
      }),
    );
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({
      results: { successful: 2, failed: 0 },
    });
    const rows = await db
      .select({
        title: schema.taskTable.title,
        completedAt: schema.taskTable.completedAt,
      })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    const byTitle = new Map(rows.map((row) => [row.title, row.completedAt]));
    expect(byTitle.get("Imported done")).toBeInstanceOf(Date);
    expect(byTitle.get("Imported open")).toBeNull();
  });

  it("returns completedAt on task detail", async () => {
    const { app, project } = await context();
    const task = await seedTask(project.id, "to-do");
    await app.request(
      `/api/task/status/${task.id}`,
      json("PUT", { status: "done" }),
    );

    const response = await app.request(`/api/task/${task.id}`);
    const detail = (await response.json()) as { completedAt: string | null };

    expect(detail.completedAt).not.toBeNull();
  });
});
