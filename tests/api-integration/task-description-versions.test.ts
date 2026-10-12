import { asc, desc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { taskDescriptionVersionTable } from "../../apps/api/src/database/schema";
import { resetTestDatabase } from "./helpers/database";
import { json, settledActivity, taskDetailScene } from "./helpers/task-detail";

type VersionJson = {
  id: string;
  taskId: string;
  authorId: string | null;
  author: { id: string; name: string; image: string | null } | null;
  savedAt: string;
  size: number;
  preview: string;
};

const versions = taskDescriptionVersionTable;

async function storedVersions(taskId: string) {
  return db
    .select()
    .from(versions)
    .where(eq(versions.taskId, taskId))
    .orderBy(asc(versions.savedAt), asc(versions.id));
}

/** Moves every version of the task back in time, as if saved earlier. */
async function ageVersions(taskId: string, minutes: number) {
  await db
    .update(versions)
    .set({
      savedAt: sql`${versions.savedAt} - make_interval(mins => ${minutes})`,
    })
    .where(eq(versions.taskId, taskId));
}

async function scene() {
  const context = await taskDetailScene();
  const { as, admin, member, viewer, outsider } = context;
  const save = (
    user: typeof admin,
    taskId: string,
    description: string,
  ): Promise<Response> =>
    as(user)(`/task/description/${taskId}`, json("PUT", { description }));
  return {
    ...context,
    save,
    asAdmin: as(admin),
    asMember: as(member),
    asViewer: as(viewer),
    asOutsider: as(outsider),
  };
}

describe("task description history", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("folds one author's saves within ten minutes into one version", async () => {
    const { createTask, save, member } = await scene();
    const task = await createTask();

    expect((await save(member, task.id, "first")).status).toBe(200);
    expect((await save(member, task.id, "second")).status).toBe(200);

    const rows = await storedVersions(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authorId: member.id, content: "second" });
  });

  it("starts a new version after the window or for another author", async () => {
    const { createTask, save, member, admin } = await scene();
    const task = await createTask();

    await save(member, task.id, "one");
    await ageVersions(task.id, 11);
    await save(member, task.id, "two");
    expect((await storedVersions(task.id)).map((row) => row.content)).toEqual([
      "one",
      "two",
    ]);

    await save(admin, task.id, "three");
    const rows = await storedVersions(task.id);
    expect(rows.map((row) => [row.authorId, row.content])).toEqual([
      [member.id, "one"],
      [member.id, "two"],
      [admin.id, "three"],
    ]);
  });

  it("keeps the text a task had before its history began", async () => {
    const { createTask, save, member } = await scene();
    const task = await createTask({ description: "original text" });

    await save(member, task.id, "edited");

    const rows = await storedVersions(task.id);
    expect(rows.map((row) => [row.authorId, row.content])).toEqual([
      [null, "original text"],
      [member.id, "edited"],
    ]);
  });

  it("records nothing when the text does not change", async () => {
    const { createTask, save, member } = await scene();
    const task = await createTask({ description: "same" });
    await save(member, task.id, "same");
    expect(await storedVersions(task.id)).toHaveLength(0);
  });

  it("records full task updates too", async () => {
    const { createTask, asMember, member, project } = await scene();
    const task = await createTask();
    const response = await asMember(
      `/task/${task.id}`,
      json("PUT", {
        title: task.title,
        status: task.status,
        projectId: project.id,
        description: "from the full update",
        priority: task.priority,
        position: task.position ?? 0,
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await storedVersions(task.id);
    expect(rows.map((row) => [row.authorId, row.content])).toEqual([
      [member.id, "from the full update"],
    ]);
  });

  it("keeps the newest 50 versions", async () => {
    const { createTask, save, member, admin } = await scene();
    const task = await createTask({ description: "v50" });
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    await db.insert(versions).values(
      Array.from({ length: 50 }, (_, index) => ({
        taskId: task.id,
        authorId: admin.id,
        content: `v${index + 1}`,
        savedAt: new Date(base + index * 60_000),
        createdAt: new Date(base + index * 60_000),
      })),
    );

    await save(member, task.id, "v51");

    const rows = await storedVersions(task.id);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.content).toBe("v2");
    expect(rows.at(-1)).toMatchObject({ authorId: member.id, content: "v51" });
  });

  it("lists versions newest first with author, size and preview, and reads one", async () => {
    const { createTask, save, member, asViewer } = await scene();
    const task = await createTask();
    await save(member, task.id, "# Plan\n\n**Ship** it, @soon");

    const list = await asViewer(`/task/${task.id}/description-versions`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as VersionJson[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      taskId: task.id,
      authorId: member.id,
      author: { id: member.id, name: "Ben" },
      size: "# Plan\n\n**Ship** it, @soon".length,
      preview: "Plan Ship it, @soon",
    });

    const one = await asViewer(
      `/task/${task.id}/description-versions/${body[0]?.id}`,
    );
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({
      id: body[0]?.id,
      content: "# Plan\n\n**Ship** it, @soon",
    });
  });

  it("restores a version through the normal update, as a new version with activity", async () => {
    const { createTask, save, member, admin, asAdmin } = await scene();
    const task = await createTask();
    await save(member, task.id, "good text");
    await ageVersions(task.id, 11);
    await save(admin, task.id, "bad text");
    await settledActivity(task.id, "description_changed", 2);
    const [good] = await storedVersions(task.id);

    const response = await asAdmin(
      `/task/${task.id}/description-versions/${good?.id}/restore`,
      { method: "POST" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      id: task.id,
      description: "good text",
    });

    const [stored] = await db
      .select({ description: schema.taskTable.description })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(stored?.description).toBe("good text");

    // The admin saved within the window, but a restore is never folded in.
    const rows = await storedVersions(task.id);
    expect(rows.map((row) => [row.authorId, row.content])).toEqual([
      [member.id, "good text"],
      [admin.id, "bad text"],
      [admin.id, "good text"],
    ]);

    // Same person within ten minutes: the activity row is refreshed, so the
    // restore is visible as the newest description change.
    const activity = await db
      .select({
        type: schema.activityTable.type,
        userId: schema.activityTable.userId,
      })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id))
      .orderBy(desc(schema.activityTable.createdAt));
    expect(activity[0]).toEqual({
      type: "description_changed",
      userId: admin.id,
    });
  });

  it("writes an activity row when someone else restores", async () => {
    const { createTask, save, member, admin, asAdmin } = await scene();
    const task = await createTask();
    await save(member, task.id, "first");
    await ageVersions(task.id, 11);
    await save(member, task.id, "second");
    await settledActivity(task.id, "description_changed", 1);
    const [first] = await storedVersions(task.id);

    const response = await asAdmin(
      `/task/${task.id}/description-versions/${first?.id}/restore`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const rows = await settledActivity(task.id, "description_changed", 2);
    expect(rows.at(-1)?.userId).toBe(admin.id);
  });

  it("needs task:read to view and task:update to restore", async () => {
    const { createTask, save, member, asViewer, asOutsider } = await scene();
    const task = await createTask();
    await save(member, task.id, "text");
    const [version] = await storedVersions(task.id);
    const restorePath = `/task/${task.id}/description-versions/${version?.id}/restore`;

    expect(
      (await asViewer(`/task/${task.id}/description-versions`)).status,
    ).toBe(200);
    expect((await asViewer(restorePath, { method: "POST" })).status).toBe(403);
    expect(
      (await asOutsider(`/task/${task.id}/description-versions`)).status,
    ).toBe(403);
    expect((await asOutsider(restorePath, { method: "POST" })).status).toBe(
      403,
    );
  });

  it("refuses a version of another task", async () => {
    const { createTask, save, member, asAdmin } = await scene();
    const task = await createTask();
    const other = await createTask();
    await save(member, other.id, "elsewhere");
    const [version] = await storedVersions(other.id);

    const read = await asAdmin(
      `/task/${task.id}/description-versions/${version?.id}`,
    );
    expect(read.status).toBe(404);
    const restore = await asAdmin(
      `/task/${task.id}/description-versions/${version?.id}/restore`,
      { method: "POST" },
    );
    expect(restore.status).toBe(404);
  });

  it("deletes the versions with the task", async () => {
    const { createTask, save, member } = await scene();
    const task = await createTask();
    await save(member, task.id, "text");
    expect(await storedVersions(task.id)).toHaveLength(1);

    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    expect(await storedVersions(task.id)).toHaveLength(0);
  });
});
