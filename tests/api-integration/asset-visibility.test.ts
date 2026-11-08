import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { readObject } = vi.hoisted(() => ({
  readObject: vi.fn(async () => ({
    body: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
    contentLength: 3,
  })),
}));
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPrivateObject: readObject,
}));

describe("API integration: public project asset visibility", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    readObject.mockClear();
  });

  async function fileIn(
    workspaceId: string,
    projectId: string,
    createdBy: string,
    surface = "comment",
    pageId?: string,
  ) {
    const [asset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId,
        projectId,
        pageId,
        objectKey: randomUUID(),
        filename: "image.png",
        mimeType: "image/png",
        size: 3,
        surface,
        createdBy,
      })
      .returning();
    if (!asset) throw new Error("no asset");
    return asset;
  }

  it("holds an API key to its projects and permissions", async () => {
    const member = await createWorkspaceMember();
    const w = member.workspace.id;
    const { project: mine } = await createProjectFixture({
      workspaceId: w,
      slug: "mine",
    });
    const { project: other } = await createProjectFixture({
      workspaceId: w,
      slug: "other",
    });
    const inMine = await fileIn(w, mine.id, member.user.id);
    const inOther = await fileIn(w, other.id, member.user.id);
    const [page] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: w,
        projectId: mine.id,
        title: "P",
        access: "public",
        ownerId: member.user.id,
      })
      .returning();
    const onPage = await fileIn(w, mine.id, member.user.id, "page", page?.id);
    const { app } = createApp();
    mockAnonymousSession();
    const fetchWith = async (headers: Record<string, string>, id: string) =>
      (await app.request(`/api/asset/${id}`, { headers })).status;

    const limited = await createApiKey(
      member.user,
      encodeScope({ access: "full", projectIds: [mine.id] }) ?? undefined,
    );
    expect(await fetchWith(limited.headers, inMine.id)).toBe(200);
    expect(await fetchWith(limited.headers, inOther.id)).toBe(404);
    expect(await fetchWith({ "x-api-key": limited.key }, inOther.id)).toBe(404);
    expect(await fetchWith({ "x-api-key": limited.key }, inMine.id)).toBe(200);

    const unlimited = await createApiKey(member.user);
    expect(await fetchWith(unlimited.headers, inOther.id)).toBe(200);

    const tasksOnly = await createApiKey(
      member.user,
      encodeScope({ access: "custom", areas: { task: "read" } }) ?? undefined,
    );
    expect(await fetchWith(tasksOnly.headers, inMine.id)).toBe(200);
    expect(await fetchWith(tasksOnly.headers, onPage.id)).toBe(404);

    const pagesOnly = await createApiKey(
      member.user,
      encodeScope({ access: "custom", areas: { page: "read" } }) ?? undefined,
    );
    expect(await fetchWith(pagesOnly.headers, onPage.id)).toBe(200);
    expect(await fetchWith(pagesOnly.headers, inMine.id)).toBe(404);

    const readOnly = await createApiKey(
      member.user,
      encodeScope({ access: "read" }) ?? undefined,
    );
    expect(await fetchWith(readOnly.headers, inMine.id)).toBe(200);
    expect(await fetchWith(readOnly.headers, onPage.id)).toBe(200);
  });

  it("stops serving a public image once its project is in the trash", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    const image = await fileIn(
      member.workspace.id,
      project.id,
      member.user.id,
      "description",
    );
    const { app } = createApp();
    mockAnonymousSession();
    expect((await app.request(`/api/asset/${image.id}`)).status).toBe(200);

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect((await app.request(`/api/asset/${image.id}`)).status).toBe(401);
    mockAuthenticatedSession(member.user);
    expect((await app.request(`/api/asset/${image.id}`)).status).toBe(404);
  });

  it("stops serving a public task's files once that task is in the trash", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "T", number: 1 })
      .returning();
    if (!task) throw new Error("no task");
    const onTask = async (surface: string) => {
      const asset = await fileIn(
        member.workspace.id,
        project.id,
        member.user.id,
        surface,
      );
      await db
        .update(schema.assetTable)
        .set({ taskId: task.id })
        .where(eq(schema.assetTable.id, asset.id));
      return asset;
    };
    const image = await onTask("description");
    const inComment = await onTask("comment");
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "comment",
      visibility: "public",
      content: `![shot](https://margaya.test/api/asset/${inComment.id})`,
    });
    const { app } = createApp();
    const statusAs = async (id: string, user?: typeof member.user) => {
      if (user) mockAuthenticatedSession(user);
      else mockAnonymousSession();
      return (await app.request(`/api/asset/${id}`)).status;
    };
    const setTrashed = (deletedAt: Date | null) =>
      db
        .update(schema.taskTable)
        .set({ deletedAt })
        .where(eq(schema.taskTable.id, task.id));

    expect(await statusAs(image.id)).toBe(200);
    expect(await statusAs(inComment.id)).toBe(200);

    await setTrashed(new Date());
    for (const id of [image.id, inComment.id]) {
      expect(await statusAs(id)).toBe(401);
      expect(await statusAs(id, member.user)).toBe(404);
    }

    // A live task on the public board that shows the file keeps it public.
    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: "Holder",
      number: 2,
      description: `![shot](https://margaya.test/api/asset/${image.id})`,
    });
    expect(await statusAs(image.id, member.user)).toBe(200);
    expect(await statusAs(image.id)).toBe(200);
    expect(await statusAs(inComment.id)).toBe(401);

    await setTrashed(null);
    expect(await statusAs(image.id)).toBe(200);
    expect(await statusAs(inComment.id)).toBe(200);
  });

  it("keeps a trashed task's image public only while live public text shows it", async () => {
    const member = await createWorkspaceMember();
    const w = member.workspace.id;
    const { project } = await createProjectFixture({ workspaceId: w });
    const { project: closed } = await createProjectFixture({
      workspaceId: w,
      slug: "closed",
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    let number = 0;
    const taskIn = async (projectId: string, description = "") => {
      number += 1;
      const [task] = await db
        .insert(schema.taskTable)
        .values({ projectId, title: "T", number, description })
        .returning();
      if (!task) throw new Error("no task");
      return task;
    };
    const source = await taskIn(project.id);
    const image = await fileIn(w, project.id, member.user.id, "description");
    await db
      .update(schema.assetTable)
      .set({ taskId: source.id })
      .where(eq(schema.assetTable.id, image.id));
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, source.id));
    const embed = `![shot](https://margaya.test/api/asset/${image.id})`;
    const { app } = createApp();
    const signedOut = async () => {
      mockAnonymousSession();
      return (await app.request(`/api/asset/${image.id}`)).status;
    };
    const signedIn = async () => {
      mockAuthenticatedSession(member.user);
      return (await app.request(`/api/asset/${image.id}`)).status;
    };
    const removeHolders = async () => {
      await db
        .delete(schema.taskTable)
        .where(eq(schema.taskTable.description, embed));
      await db
        .delete(schema.activityTable)
        .where(eq(schema.activityTable.content, embed));
      await db
        .delete(schema.pageTable)
        .where(eq(schema.pageTable.contentMarkdown, embed));
    };

    // Private text keeps the file for the workspace, never for the public.
    await taskIn(closed.id, embed);
    const onBoard = await taskIn(project.id);
    await db
      .insert(schema.activityTable)
      .values({ taskId: onBoard.id, type: "comment", content: embed });
    await db
      .update(schema.workspaceTable)
      .set({ allowPublicPages: true })
      .where(eq(schema.workspaceTable.id, w));
    await db.insert(schema.pageTable).values({
      workspaceId: w,
      projectId: project.id,
      title: "Unpublished",
      access: "public",
      ownerId: member.user.id,
      contentMarkdown: embed,
    });
    const trashedHolder = await taskIn(project.id, embed);
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, trashedHolder.id));
    expect(await signedIn()).toBe(200);
    expect(await signedOut()).toBe(401);

    // A public comment on the board shows it.
    await removeHolders();
    await db.insert(schema.activityTable).values({
      taskId: onBoard.id,
      type: "comment",
      visibility: "public",
      content: embed,
    });
    expect(await signedOut()).toBe(200);

    // So does a published page, until the workspace stops allowing them.
    await removeHolders();
    await db.insert(schema.pageTable).values({
      workspaceId: w,
      projectId: closed.id,
      title: "Published",
      access: "public",
      ownerId: member.user.id,
      contentMarkdown: embed,
      publicToken: `pg_${randomUUID().replaceAll("-", "")}`,
      publishedAt: new Date(),
    });
    expect(await signedOut()).toBe(200);
    await db
      .update(schema.workspaceTable)
      .set({ allowPublicPages: false })
      .where(eq(schema.workspaceTable.id, w));
    expect(await signedOut()).toBe(401);
    expect(await signedIn()).toBe(200);

    // A public board of another workspace shows nothing of this one.
    await removeHolders();
    const stranger = await createWorkspaceMember();
    const { project: theirs } = await createProjectFixture({
      workspaceId: stranger.workspace.id,
      slug: "theirs",
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, theirs.id));
    await taskIn(theirs.id, embed);
    expect(await signedOut()).toBe(401);
  });

  it("doesn't make a trashed task's attachment public, whatever shows it", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    const [source] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "T",
        number: 1,
        deletedAt: new Date(),
      })
      .returning();
    const file = await fileIn(
      member.workspace.id,
      project.id,
      member.user.id,
      "attachment",
    );
    await db
      .update(schema.assetTable)
      .set({ taskId: source?.id })
      .where(eq(schema.assetTable.id, file.id));
    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: "Holder",
      number: 2,
      description: `[file](https://margaya.test/api/asset/${file.id})`,
    });
    const { app } = createApp();
    mockAnonymousSession();
    expect((await app.request(`/api/asset/${file.id}`)).status).toBe(401);
  });

  it("serves public descriptions but denies anonymous and other-workspace access to comment assets", async () => {
    const member = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    const assets = await db
      .insert(schema.assetTable)
      .values(
        ["description", "comment"].map((surface) => ({
          workspaceId: member.workspace.id,
          projectId: project.id,
          objectKey: randomUUID(),
          filename: "image.png",
          mimeType: "image/png",
          size: 3,
          surface,
          createdBy: member.user.id,
        })),
      )
      .returning();
    const description = assets.find((a) => a.surface === "description");
    const comment = assets.find((a) => a.surface === "comment");
    const { app } = createApp();
    mockAnonymousSession();
    const publicResponse = await app.request(`/api/asset/${description?.id}`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toMatch(/^public,/);
    expect((await app.request(`/api/asset/${comment?.id}`)).status).toBe(401);
    expect(readObject).toHaveBeenCalledTimes(1);

    mockAuthenticatedSession(outsider.user);
    expect((await app.request(`/api/asset/${comment?.id}`)).status).toBe(404);
    expect(readObject).toHaveBeenCalledTimes(1);

    mockAuthenticatedSession(member.user);
    const privateResponse = await app.request(`/api/asset/${comment?.id}`);
    expect(privateResponse.status).toBe(200);
    expect(privateResponse.headers.get("cache-control")).toMatch(/^private,/);
    expect(readObject).toHaveBeenCalledTimes(2);
  });
});
