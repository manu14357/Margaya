import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, queryScene } from "./helpers/task-query";

async function creatorOf(taskId: string) {
  const [task] = await db
    .select({ createdBy: schema.taskTable.createdBy })
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return task?.createdBy;
}

// D13: every create path records its caller as the task's creator; the
// import, integration and backfill paths are covered in task-archive and
// github-import-status.
describe("API integration: task creator", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records the caller on create, copy and in every task payload", async () => {
    const s = await queryScene();
    const created = await s.app.request(
      `/api/task/${s.project.id}`,
      json("POST", {
        title: "Mine",
        description: "",
        priority: "low",
        status: "to-do",
      }),
    );
    expect(created.status).toBe(200);
    const task = (await created.json()) as { id: string; createdBy: string };
    expect(task.createdBy).toBe(s.owner.id);
    expect(await creatorOf(task.id)).toBe(s.owner.id);

    const detail = await s.app.request(`/api/task/${task.id}`);
    expect(((await detail.json()) as { createdBy: string }).createdBy).toBe(
      s.owner.id,
    );

    // A copy belongs to whoever made it.
    mockAuthenticatedSession(s.ben);
    const copy = await s.app.request(
      `/api/task-copy/${task.id}`,
      json("POST", {}),
    );
    expect(copy.status, await copy.clone().text()).toBe(200);
    const copied = (await copy.json()) as { task: { id: string } };
    expect(await creatorOf(copied.task.id)).toBe(s.ben.id);

    const byMe = await s.query(
      {
        filters: { key: "createdBy", operator: "in", values: ["me"] },
        mode: "ids",
      },
      s.ben,
    );
    expect(byMe.ids).toEqual([copied.task.id]);
  });

  it("clears the creator when the user is deleted", async () => {
    const s = await queryScene();
    const task = await s.createTask({ createdBy: s.cara.id });
    await db.delete(schema.userTable).where(eq(schema.userTable.id, s.cara.id));
    expect(await creatorOf(task.id)).toBeNull();
  });
});
