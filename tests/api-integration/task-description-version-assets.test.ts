import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { taskDescriptionVersionTable } from "../../apps/api/src/database/schema";
import { resetTestDatabase } from "./helpers/database";
import { json, taskDetailScene } from "./helpers/task-detail";

// Removing an image from a description must not delete a file an older saved
// version still shows: restoring that version would show a broken image.

const { deleteObject } = vi.hoisted(() => ({
  deleteObject: vi.fn(async () => {}),
}));
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteS3Object: deleteObject,
}));

const versions = taskDescriptionVersionTable;
const WAIT = { timeout: 5000, interval: 25 };

async function scene() {
  const context = await taskDetailScene();
  const { as, member, workspace, project, createTask } = context;
  const task = await createTask();
  const addImage = async () => {
    const [asset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        taskId: task.id,
        objectKey: randomUUID(),
        filename: "image.png",
        mimeType: "image/png",
        size: 3,
        surface: "description",
        createdBy: member.id,
      })
      .returning();
    if (!asset) throw new Error("Failed to create asset");
    return asset;
  };
  const save = async (description: string) => {
    const response = await as(member)(
      `/task/description/${task.id}`,
      json("PUT", { description }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
  };
  const age = () =>
    db
      .update(versions)
      .set({ savedAt: sql`${versions.savedAt} - make_interval(mins => 11)` })
      .where(eq(versions.taskId, task.id));
  return { ...context, task, addImage, save, age };
}

const imageUrl = (id: string) => `![shot](/api/asset/${id})`;

async function assetExists(id: string) {
  const [row] = await db
    .select({ id: schema.assetTable.id })
    .from(schema.assetTable)
    .where(eq(schema.assetTable.id, id));
  return Boolean(row);
}

/** Long enough for a background cleanup that would delete it to have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("images used by saved description versions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    deleteObject.mockClear();
  });

  it("keeps the file when it is removed, so a restore still shows it", async () => {
    const { task, as, admin, addImage, save, age } = await scene();
    const image = await addImage();

    await save(`Before ${imageUrl(image.id)}`);
    await age();
    await save("Without the image");
    await settle();

    expect(deleteObject).not.toHaveBeenCalled();
    expect(await assetExists(image.id)).toBe(true);

    const [oldest] = await db
      .select({ id: versions.id })
      .from(versions)
      .where(eq(versions.taskId, task.id))
      .orderBy(versions.savedAt)
      .limit(1);
    const restored = await as(admin)(
      `/task/${task.id}/description-versions/${oldest?.id}/restore`,
      { method: "POST" },
    );
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(await restored.json()).toMatchObject({
      description: `Before ${imageUrl(image.id)}`,
    });
    await settle();
    expect(await assetExists(image.id)).toBe(true);
  });

  it("deletes the file once the last version using it is pruned", async () => {
    const { task, admin, addImage, save, age } = await scene();
    const image = await addImage();

    await save(imageUrl(image.id));
    await age();
    await save("Without the image");
    await age();

    // Another author's versions fill the history to its limit of 50, so the
    // next save is a new version and pushes the oldest out.
    const base = Date.now() - 10 * 60_000;
    await db.insert(versions).values(
      Array.from({ length: 48 }, (_, index) => ({
        taskId: task.id,
        authorId: admin.id,
        content: `Filler ${index}`,
        savedAt: new Date(base + index),
        createdAt: new Date(base + index),
      })),
    );
    expect(await assetExists(image.id)).toBe(true);

    await save("Newest text");

    await vi.waitFor(
      async () => expect(await assetExists(image.id)).toBe(false),
      WAIT,
    );
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(image.objectKey);
  });

  it("keeps a pruned version's image the description still uses", async () => {
    const { task, admin, addImage, save, age } = await scene();
    const image = await addImage();

    await save(imageUrl(image.id));
    await age();

    const base = Date.now() - 10 * 60_000;
    await db.insert(versions).values(
      Array.from({ length: 49 }, (_, index) => ({
        taskId: task.id,
        authorId: admin.id,
        content: `Filler ${index}`,
        savedAt: new Date(base + index),
        createdAt: new Date(base + index),
      })),
    );

    await save(`Still here ${imageUrl(image.id)}`);
    await settle();

    const contents = await db
      .select({ content: versions.content })
      .from(versions)
      .where(eq(versions.taskId, task.id));
    expect(contents).toHaveLength(50);
    expect(contents.map((row) => row.content)).not.toContain(
      imageUrl(image.id),
    );

    expect(deleteObject).not.toHaveBeenCalled();
    expect(await assetExists(image.id)).toBe(true);
  });

  it("deletes the file when no saved version kept it", async () => {
    const { addImage, save } = await scene();
    const image = await addImage();

    // The same author within ten minutes: one version, updated in place.
    await save(imageUrl(image.id));
    await save("Removed straight away");

    await vi.waitFor(
      async () => expect(await assetExists(image.id)).toBe(false),
      WAIT,
    );
    expect(deleteObject).toHaveBeenCalledWith(image.objectKey);
  });
});
