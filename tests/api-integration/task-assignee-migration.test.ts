import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { migrateTaskAssignees } from "../../apps/api/src/migrations/task-assignee-migration";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const OLD = new Date("2021-03-04T05:06:07.000Z");

async function scene() {
  const owner = await createWorkspaceMember({ role: "owner", userName: "Ada" });
  const ben = await addPerson(owner.workspace.id, "Ben");
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  let nextNumber = 1;
  // Written straight to the tables, bypassing the API, like legacy data.
  const task = async (mirror: string | null) => {
    const [created] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: `Task ${nextNumber}`,
        number: nextNumber++,
        userId: mirror,
        updatedAt: OLD,
      })
      .returning();
    if (!created) throw new Error("Failed to create task");
    return created;
  };
  return { ada: owner.user, ben, task };
}

async function rowsOf(taskId: string) {
  return db
    .select({
      userId: schema.taskAssigneeTable.userId,
      position: schema.taskAssigneeTable.position,
      createdAt: schema.taskAssigneeTable.createdAt,
    })
    .from(schema.taskAssigneeTable)
    .where(eq(schema.taskAssigneeTable.taskId, taskId))
    .orderBy(asc(schema.taskAssigneeTable.position));
}

async function stored(taskId: string) {
  const [task] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return task;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("task assignee startup migration", () => {
  it("backfills a mirror without rows as the only assignee", async () => {
    const { ada, task } = await scene();
    const legacy = await task(ada.id);

    expect(await migrateTaskAssignees()).toEqual({
      backfilled: 1,
      repaired: 0,
    });
    expect(await rowsOf(legacy.id)).toEqual([
      { userId: ada.id, position: 0, createdAt: OLD },
    ]);
    expect((await stored(legacy.id))?.updatedAt).toEqual(OLD);
  });

  it("repairs a mirror that disagrees with the rows, without touching updated_at", async () => {
    const { ada, ben, task } = await scene();
    const missing = await task(null);
    await db
      .insert(schema.taskAssigneeTable)
      .values({ taskId: missing.id, userId: ben.id, position: 3 });
    const stale = await task(ada.id);
    await db.insert(schema.taskAssigneeTable).values([
      { taskId: stale.id, userId: ben.id, position: 0 },
      { taskId: stale.id, userId: ada.id, position: 1 },
    ]);
    const orphan = await task(null);

    expect(await migrateTaskAssignees()).toEqual({
      backfilled: 0,
      repaired: 2,
    });
    expect((await stored(missing.id))?.userId).toBe(ben.id);
    expect((await stored(stale.id))?.userId).toBe(ben.id);
    expect((await stored(orphan.id))?.userId).toBeNull();
    for (const id of [missing.id, stale.id]) {
      expect((await stored(id))?.updatedAt).toEqual(OLD);
    }
  });

  it("changes nothing on a second run or a clean database", async () => {
    const { ada, task } = await scene();
    await task(ada.id);
    await task(null);

    await migrateTaskAssignees();
    expect(await migrateTaskAssignees()).toEqual({
      backfilled: 0,
      repaired: 0,
    });
  });
});
