import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { runTrashPurge } from "../../apps/api/src/trash/purge-job";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { json, type PageScene, pageScene } from "./helpers/pages";

function mockStorage() {
  const deleted: string[] = [];
  vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: 12, ContentType: "image/png" } as never;
    }
    if (command instanceof DeleteObjectCommand) {
      deleted.push(command.input.Key as string);
      return {} as never;
    }
    if (command instanceof GetObjectCommand) {
      return {
        Body: {
          transformToWebStream: () =>
            new Blob([new Uint8Array([1, 2, 3])]).stream(),
        },
        ContentType: "image/png",
        ContentLength: 3,
      } as never;
    }
    throw new Error("unexpected storage call");
  });
  return deleted;
}

async function upload(s: PageScene, user: PageScene["ben"], pageId: string) {
  const body = { filename: "shot.png", contentType: "image/png", size: 12 };
  const presigned = await s.ok<{ key: string; uploadUrl: string }>(
    user,
    `/${pageId}/asset-upload`,
    json("PUT", body),
  );
  expect(presigned.key).toContain(`/page/${pageId}/files/`);
  return s.ok<{ id: string; url: string }>(
    user,
    `/${pageId}/asset-upload/finalize`,
    json("POST", { ...body, key: presigned.key }),
  );
}

async function assetRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.assetTable)
    .where(eq(schema.assetTable.id, id));
  return row;
}

const embed = (assetId: string) =>
  `![shot](https://margaya.test/api/asset/${assetId})`;

let nextTaskNumber = 500;
async function taskIn(projectId: string, description = "") {
  nextTaskNumber += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title: "T", number: nextTaskNumber, description })
    .returning();
  if (!task) throw new Error("no task");
  return task;
}

async function commentOn(taskId: string, content: string) {
  const [comment] = await db
    .insert(schema.activityTable)
    .values({ taskId, type: "comment", content })
    .returning();
  if (!comment) throw new Error("no comment");
  return comment;
}

async function fileOnTask(
  s: PageScene,
  taskId: string,
  surface = "attachment",
) {
  const [asset] = await db
    .insert(schema.assetTable)
    .values({
      workspaceId: s.workspaceId,
      projectId: s.project.id,
      taskId,
      objectKey: randomUUID(),
      filename: "file.png",
      mimeType: "image/png",
      size: 3,
      surface,
      createdBy: s.ben.id,
    })
    .returning();
  if (!asset) throw new Error("no asset");
  return asset;
}

const setTaskTrashed = (taskId: string, deletedAt: Date | null) =>
  db
    .update(schema.taskTable)
    .set({ deletedAt })
    .where(eq(schema.taskTable.id, taskId));

describe("API integration: page files", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.stubEnv("S3_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("S3_BUCKET", "local-test-bucket");
    vi.stubEnv("S3_ACCESS_KEY_ID", "local-test-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "local-test-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records uploads with the page, its project and surface page", async () => {
    mockStorage();
    const s = await pageScene();
    const page = await s.create(s.ben);
    const asset = await upload(s, s.ben, page.id);
    expect(asset.url).toMatch(new RegExp(`/asset/${asset.id}$`));
    expect(await assetRow(asset.id)).toMatchObject({
      pageId: page.id,
      projectId: s.project.id,
      taskId: null,
      surface: "page",
      kind: "image",
      createdBy: s.ben.id,
    });

    const wrongKey = await s.call(
      s.ben,
      `/${page.id}/asset-upload/finalize`,
      json("POST", {
        key: "workspace/x/project/y/page/z/files/a.png",
        filename: "a.png",
        contentType: "image/png",
        size: 12,
      }),
    );
    expect(wrongKey.status).toBe(400);
  });

  it("serves a private page's files to its owner only", async () => {
    mockStorage();
    const s = await pageScene();
    const page = await s.create(s.ben, { access: "private" });
    const asset = await upload(s, s.ben, page.id);

    mockAuthenticatedSession(s.cara);
    expect((await s.app.request(`/api/asset/${asset.id}`)).status).toBe(404);
    mockAuthenticatedSession(s.admin);
    expect((await s.app.request(`/api/asset/${asset.id}`)).status).toBe(404);
    mockAuthenticatedSession(s.ben);
    expect((await s.app.request(`/api/asset/${asset.id}`)).status).toBe(200);
  });

  describe("of a page in the trash", () => {
    const fetchAs = (s: PageScene, user: PageScene["ben"], assetId: string) => {
      mockAuthenticatedSession(user);
      return s.app.request(`/api/asset/${assetId}`);
    };
    const trash = async (s: PageScene, pageId: string) => {
      await s.ok(s.ben, `/${pageId}/archive`, { method: "POST" });
      await s.ok(s.ben, `/${pageId}`, { method: "DELETE" });
    };

    it("reads the file as gone until the page is restored", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

      await trash(s, page.id);
      expect(await assetRow(asset.id)).toMatchObject({ pageId: page.id });

      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
      expect((await fetchAs(s, s.ben, asset.id)).status).toBe(404);
      expect((await fetchAs(s, s.owner, asset.id)).status).toBe(404);

      mockAuthenticatedSession(s.ben);
      const restored = await s.app.request(
        `/api/trash/page/${page.id}/restore`,
        { method: "POST" },
      );
      expect(restored.status, await restored.clone().text()).toBe(200);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("keeps serving a file another live page still shows", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const shared = await upload(s, s.ben, page.id);
      const unshared = await upload(s, s.ben, page.id);
      await s.ok(
        s.ben,
        `/${page.id}/content`,
        json("PUT", {
          markdown: `![shot](https://margaya.test/api/asset/${shared.id})`,
        }),
      );
      // A duplicate shows the original's files until that is purged.
      await s.ok(s.ben, `/${page.id}/duplicate`, { method: "POST" });

      await trash(s, page.id);

      expect((await fetchAs(s, s.cara, shared.id)).status).toBe(200);
      expect((await fetchAs(s, s.cara, unshared.id)).status).toBe(404);
    });

    it("keeps serving a file a live task's description shows", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      const holder = await taskIn(s.project.id, embed(asset.id));

      await trash(s, page.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

      await setTaskTrashed(holder.id, new Date());
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });

    it("keeps serving a file a comment on a live task shows", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      const holder = await taskIn(s.project.id);
      await commentOn(holder.id, embed(asset.id));

      await trash(s, page.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

      await setTaskTrashed(holder.id, new Date());
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });
  });

  describe("of a task in the trash", () => {
    const fetchAs = (s: PageScene, user: PageScene["ben"], assetId: string) => {
      mockAuthenticatedSession(user);
      return s.app.request(`/api/asset/${assetId}`);
    };
    const trashTask = async (s: PageScene, taskId: string) => {
      mockAuthenticatedSession(s.admin);
      const response = await s.app.request(`/api/task/${taskId}`, {
        method: "DELETE",
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    const restoreTask = async (s: PageScene, taskId: string) => {
      mockAuthenticatedSession(s.admin);
      const response = await s.app.request(
        `/api/trash/task/${taskId}/restore`,
        { method: "POST" },
      );
      expect(response.status, await response.clone().text()).toBe(200);
    };

    it.each(["attachment", "description", "comment"])(
      "reads its %s file as gone until it is restored",
      async (surface) => {
        mockStorage();
        const s = await pageScene();
        const task = await taskIn(s.project.id);
        const asset = await fileOnTask(s, task.id, surface);
        expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

        await trashTask(s, task.id);
        // Kept for the restore: nothing is deleted while it is in the trash.
        expect(await assetRow(asset.id)).toMatchObject({ taskId: task.id });
        for (const user of [s.cara, s.ben, s.admin, s.owner]) {
          expect((await fetchAs(s, user, asset.id)).status).toBe(404);
        }

        await restoreTask(s, task.id);
        expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
      },
    );

    it("isn't kept by the task's own description and comments", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const asset = await fileOnTask(s, task.id, "description");
      await db
        .update(schema.taskTable)
        .set({ description: embed(asset.id) })
        .where(eq(schema.taskTable.id, task.id));
      await commentOn(task.id, embed(asset.id));

      await trashTask(s, task.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });

    it("keeps serving a file another live task's description shows", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const asset = await fileOnTask(s, task.id);
      const unshared = await fileOnTask(s, task.id);
      const holder = await taskIn(s.project.id, embed(asset.id));

      await trashTask(s, task.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
      expect((await fetchAs(s, s.cara, unshared.id)).status).toBe(404);

      // Once nothing live shows it, it goes; restoring either brings it back.
      await trashTask(s, holder.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
      await restoreTask(s, holder.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("keeps serving a file a copy's description still links", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      // A copy duplicates the task's own description images and leaves every
      // other file link as it is, so this attachment stays the original's.
      const asset = await fileOnTask(s, task.id, "attachment");
      await db
        .update(schema.taskTable)
        .set({ description: embed(asset.id) })
        .where(eq(schema.taskTable.id, task.id));
      mockAuthenticatedSession(s.admin);
      const copied = await s.app.request(
        `/api/task-copy/${task.id}`,
        json("POST", { include: ["description"] }),
      );
      expect(copied.status, await copied.clone().text()).toBe(200);

      await trashTask(s, task.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("keeps serving a file a comment on a live task shows", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const asset = await fileOnTask(s, task.id);
      const holder = await taskIn(s.project.id);
      const comment = await commentOn(holder.id, embed(asset.id));

      await trashTask(s, task.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

      await db
        .delete(schema.activityTable)
        .where(eq(schema.activityTable.id, comment.id));
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });

    it("keeps serving a file a live page shows", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const asset = await fileOnTask(s, task.id);
      const page = await s.create(s.ben, { content: embed(asset.id) });

      await trashTask(s, task.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

      await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
      await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });

    it("isn't kept by what another workspace or a trashed project shows", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const asset = await fileOnTask(s, task.id);

      const stranger = await createWorkspaceMember({ workspaceName: "Other" });
      const { project: strangers } = await createProjectFixture({
        workspaceId: stranger.workspace.id,
        slug: "theirs",
      });
      await taskIn(strangers.id, embed(asset.id));
      await commentOn((await taskIn(strangers.id)).id, embed(asset.id));

      const trashedProject = await s.project2();
      await taskIn(trashedProject.id, embed(asset.id));
      await commentOn((await taskIn(trashedProject.id)).id, embed(asset.id));
      await db
        .update(schema.projectTable)
        .set({ deletedAt: new Date() })
        .where(eq(schema.projectTable.id, trashedProject.id));

      await trashTask(s, task.id);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });
  });

  describe("of a project in the trash", () => {
    const fetchAs = (s: PageScene, user: PageScene["ben"], assetId: string) => {
      mockAuthenticatedSession(user);
      return s.app.request(`/api/asset/${assetId}`);
    };
    const setTrashed = (projectId: string, deletedAt: Date | null) =>
      db
        .update(schema.projectTable)
        .set({ deletedAt })
        .where(eq(schema.projectTable.id, projectId));

    it("reads a page's file as gone, though the page itself is not stamped", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      // The page shows its own file, which must not keep it alive.
      await s.ok(
        s.ben,
        `/${page.id}/content`,
        json("PUT", {
          markdown: `![shot](https://margaya.test/api/asset/${asset.id})`,
        }),
      );
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);

      await setTrashed(s.project.id, new Date());
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
      expect((await fetchAs(s, s.ben, asset.id)).status).toBe(404);

      await setTrashed(s.project.id, null);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("keeps a file a page of a live project still shows", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      const other = await s.project2();
      await s.create(
        s.ben,
        { content: `![shot](https://margaya.test/api/asset/${asset.id})` },
        other.id,
      );

      await setTrashed(s.project.id, new Date());
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("keeps a file a task of a live project still shows", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      const other = await s.project2();
      await taskIn(other.id, embed(asset.id));

      await setTrashed(s.project.id, new Date());
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("isn't kept by a task of that same project", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const asset = await upload(s, s.ben, page.id);
      const holder = await taskIn(s.project.id, embed(asset.id));
      await commentOn(holder.id, embed(asset.id));

      await setTrashed(s.project.id, new Date());
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(404);
    });

    it("reads a task's file as gone too", async () => {
      mockStorage();
      const s = await pageScene();
      const [task] = await db
        .insert(schema.taskTable)
        .values({ projectId: s.project.id, title: "T", number: 500 })
        .returning();
      const [asset] = await db
        .insert(schema.assetTable)
        .values({
          workspaceId: s.workspaceId,
          projectId: s.project.id,
          taskId: task?.id,
          objectKey: "task/file.png",
          filename: "file.png",
          mimeType: "image/png",
          size: 3,
          surface: "comment",
          createdBy: s.ben.id,
        })
        .returning();
      const id = asset?.id ?? "";
      expect((await fetchAs(s, s.cara, id)).status).toBe(200);

      await setTrashed(s.project.id, new Date());
      expect((await fetchAs(s, s.cara, id)).status).toBe(404);
    });
  });

  describe("of a task deleted for good", () => {
    const fetchAs = (s: PageScene, user: PageScene["ben"], assetId: string) => {
      mockAuthenticatedSession(user);
      return s.app.request(`/api/asset/${assetId}`);
    };
    const purgeTask = async (s: PageScene, taskId: string) => {
      mockAuthenticatedSession(s.admin);
      const trashed = await s.app.request(`/api/task/${taskId}`, {
        method: "DELETE",
      });
      expect(trashed.status, await trashed.clone().text()).toBe(200);
      const purged = await s.app.request(`/api/trash/task/${taskId}`, {
        method: "DELETE",
      });
      expect(purged.status, await purged.clone().text()).toBe(200);
    };
    const purgeProject = async (s: PageScene, projectId: string) => {
      mockAuthenticatedSession(s.admin);
      for (const path of [
        `/api/project/${projectId}`,
        `/api/trash/projects/${projectId}`,
      ]) {
        const response = await s.app.request(path, { method: "DELETE" });
        expect(response.status, await response.clone().text()).toBe(200);
      }
    };

    it("hands a file a copy's description links to the copy and removes the rest", async () => {
      const deleted = mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const kept = await fileOnTask(s, task.id, "attachment");
      const dropped = await fileOnTask(s, task.id, "attachment");
      const ownImage = await fileOnTask(s, task.id, "description");
      await db
        .update(schema.taskTable)
        .set({ description: embed(ownImage.id) })
        .where(eq(schema.taskTable.id, task.id));
      await commentOn(task.id, embed(dropped.id));
      const copy = await taskIn(s.project.id, embed(kept.id));

      await purgeTask(s, task.id);

      // Now the copy's description image, not an attachment of the copy.
      expect(await assetRow(kept.id)).toMatchObject({
        taskId: copy.id,
        projectId: s.project.id,
        surface: "description",
      });
      expect((await fetchAs(s, s.cara, kept.id)).status).toBe(200);
      expect(await assetRow(dropped.id)).toBeUndefined();
      expect(await assetRow(ownImage.id)).toBeUndefined();
      await vi.waitFor(() => expect(deleted).toHaveLength(2));
      expect(deleted.sort()).toEqual(
        [dropped.objectKey, ownImage.objectKey].sort(),
      );

      // The copy shows it in its description, not among its attachments.
      mockAuthenticatedSession(s.admin);
      const attachments = await s.app.request(
        `/api/task-attachment/${copy.id}`,
      );
      expect(attachments.status, await attachments.clone().text()).toBe(200);
      expect(JSON.stringify(await attachments.json())).not.toContain(kept.id);
    });

    it("hands a file to a comment or a page that still shows it", async () => {
      const deleted = mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const inComment = await fileOnTask(s, task.id);
      const onPage = await fileOnTask(s, task.id, "comment");
      const holder = await taskIn(s.project.id);
      await commentOn(holder.id, embed(inComment.id));
      const page = await s.create(s.ben, { content: embed(onPage.id) });

      await purgeTask(s, task.id);

      expect(await assetRow(inComment.id)).toMatchObject({
        taskId: holder.id,
        pageId: null,
        surface: "comment",
      });
      expect(await assetRow(onPage.id)).toMatchObject({
        taskId: null,
        pageId: page.id,
        projectId: s.project.id,
        surface: "page",
      });
      expect((await fetchAs(s, s.cara, inComment.id)).status).toBe(200);
      expect((await fetchAs(s, s.cara, onPage.id)).status).toBe(200);
      expect(deleted).toHaveLength(0);
    });

    it("isn't kept by what leaves with it or by another workspace", async () => {
      const deleted = mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const lonely = await fileOnTask(s, task.id);
      // A task deleted with it, and another workspace's task and comment.
      const sibling = await taskIn(s.project.id, embed(lonely.id));
      const stranger = await createWorkspaceMember({ workspaceName: "Other" });
      const { project: strangers } = await createProjectFixture({
        workspaceId: stranger.workspace.id,
        slug: "theirs",
      });
      await taskIn(strangers.id, embed(lonely.id));
      await commentOn((await taskIn(strangers.id)).id, embed(lonely.id));

      mockAuthenticatedSession(s.admin);
      for (const id of [task.id, sibling.id]) {
        const response = await s.app.request(`/api/task/${id}`, {
          method: "DELETE",
        });
        expect(response.status).toBe(200);
      }
      const emptied = await s.app.request(
        `/api/trash/project/${s.project.id}/empty`,
        { method: "POST" },
      );
      expect(emptied.status, await emptied.clone().text()).toBe(200);

      expect(await assetRow(lonely.id)).toBeUndefined();
      await vi.waitFor(() => expect(deleted).toEqual([lonely.objectKey]));
    });

    it("prefers live text, then text of the file's own project", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const first = await fileOnTask(s, task.id);
      const second = await fileOnTask(s, task.id);
      const other = await s.project2();
      const trashedHere = await taskIn(s.project.id, embed(first.id));
      await setTaskTrashed(trashedHere.id, new Date());
      const liveThere = await taskIn(other.id, embed(first.id));
      await taskIn(other.id, embed(second.id));
      const liveHere = await taskIn(s.project.id);
      await commentOn(liveHere.id, embed(second.id));

      await purgeTask(s, task.id);

      expect(await assetRow(first.id)).toMatchObject({
        taskId: liveThere.id,
        projectId: other.id,
      });
      expect(await assetRow(second.id)).toMatchObject({
        taskId: liveHere.id,
        projectId: s.project.id,
        surface: "comment",
      });
    });

    it("keeps a file a trashed task links, for its restore", async () => {
      mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const asset = await fileOnTask(s, task.id);
      const holder = await taskIn(s.project.id, embed(asset.id));
      await setTaskTrashed(holder.id, new Date());

      await purgeTask(s, task.id);

      expect(await assetRow(asset.id)).toMatchObject({ taskId: holder.id });
      await setTaskTrashed(holder.id, null);
      expect((await fetchAs(s, s.cara, asset.id)).status).toBe(200);
    });

    it("hands files on when the whole project is purged", async () => {
      const deleted = mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const kept = await fileOnTask(s, task.id);
      const dropped = await fileOnTask(s, task.id);
      const page = await s.create(s.ben);
      const pageFile = await upload(s, s.ben, page.id);
      // Text inside the purged project keeps nothing.
      await taskIn(s.project.id, embed(dropped.id));
      await s.create(s.ben, { content: embed(dropped.id) });
      const other = await s.project2();
      const holder = await taskIn(other.id, embed(kept.id));
      const holderPage = await s.create(
        s.ben,
        { content: embed(pageFile.id) },
        other.id,
      );

      await purgeProject(s, s.project.id);

      expect(await assetRow(kept.id)).toMatchObject({
        taskId: holder.id,
        projectId: other.id,
        surface: "description",
      });
      expect(await assetRow(pageFile.id)).toMatchObject({
        pageId: holderPage.id,
        projectId: other.id,
      });
      expect(await assetRow(dropped.id)).toBeUndefined();
      await vi.waitFor(() => expect(deleted).toEqual([dropped.objectKey]));
      expect((await fetchAs(s, s.cara, kept.id)).status).toBe(200);
      expect((await fetchAs(s, s.cara, pageFile.id)).status).toBe(200);
    });

    it("hands files on when the trash is purged on schedule", async () => {
      const deleted = mockStorage();
      const s = await pageScene();
      const task = await taskIn(s.project.id);
      const kept = await fileOnTask(s, task.id);
      const dropped = await fileOnTask(s, task.id);
      const holder = await taskIn(s.project.id, embed(kept.id));
      await db
        .update(schema.taskTable)
        .set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) })
        .where(eq(schema.taskTable.id, task.id));

      const outcome = await runTrashPurge(new Date(), undefined, 30);
      expect(outcome.tasks).toBe(1);

      expect(await assetRow(kept.id)).toMatchObject({ taskId: holder.id });
      expect(await assetRow(dropped.id)).toBeUndefined();
      await vi.waitFor(() => expect(deleted).toEqual([dropped.objectKey]));
    });
  });

  it("hands linked files to another page when purged and removes the rest", async () => {
    const deleted = mockStorage();
    const s = await pageScene();
    const page = await s.create(s.ben);
    const kept = await upload(s, s.ben, page.id);
    const dropped = await upload(s, s.ben, page.id);
    await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", {
        markdown: `![shot](https://margaya.test/api/asset/${kept.id})`,
      }),
    );
    const copy = await s.ok(s.ben, `/${page.id}/duplicate`, { method: "POST" });

    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });

    // The trash keeps everything, so restoring brings the page back whole.
    expect(await assetRow(kept.id)).toMatchObject({ pageId: page.id });
    expect(await assetRow(dropped.id)).toBeDefined();
    expect(deleted).toHaveLength(0);

    mockAuthenticatedSession(s.ben);
    const purged = await s.app.request(`/api/trash/page/${page.id}`, {
      method: "DELETE",
    });
    expect(purged.status, await purged.clone().text()).toBe(200);

    expect(await assetRow(kept.id)).toMatchObject({ pageId: copy.id });
    expect(await assetRow(dropped.id)).toBeUndefined();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain(`/page/${page.id}/files/`);
  });

  describe("of a page deleted for good", () => {
    const purgePage = async (s: PageScene, pageId: string) => {
      await s.ok(s.ben, `/${pageId}/archive`, { method: "POST" });
      await s.ok(s.ben, `/${pageId}`, { method: "DELETE" });
      mockAuthenticatedSession(s.ben);
      const purged = await s.app.request(`/api/trash/page/${pageId}`, {
        method: "DELETE",
      });
      expect(purged.status, await purged.clone().text()).toBe(200);
    };

    it("hands files a task's description or comment still shows to that task", async () => {
      const deleted = mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const inDescription = await upload(s, s.ben, page.id);
      const inComment = await upload(s, s.ben, page.id);
      const unshown = await upload(s, s.ben, page.id);
      const describer = await taskIn(s.project.id, embed(inDescription.id));
      const commented = await taskIn(s.project.id);
      await commentOn(commented.id, embed(inComment.id));

      await purgePage(s, page.id);

      expect(await assetRow(inDescription.id)).toMatchObject({
        taskId: describer.id,
        pageId: null,
        projectId: s.project.id,
        surface: "description",
      });
      expect(await assetRow(inComment.id)).toMatchObject({
        taskId: commented.id,
        pageId: null,
        surface: "comment",
      });
      for (const id of [inDescription.id, inComment.id]) {
        mockAuthenticatedSession(s.cara);
        expect((await s.app.request(`/api/asset/${id}`)).status).toBe(200);
      }
      expect(await assetRow(unshown.id)).toBeUndefined();
      await vi.waitFor(() => expect(deleted).toHaveLength(1));
      expect(deleted[0]).toContain(`/page/${page.id}/files/`);
    });

    it("prefers live text, then text of the page's own project", async () => {
      mockStorage();
      const s = await pageScene();
      const page = await s.create(s.ben);
      const first = await upload(s, s.ben, page.id);
      const second = await upload(s, s.ben, page.id);
      const third = await upload(s, s.ben, page.id);
      const other = await s.project2();
      // A trashed page here loses to a live task elsewhere.
      const trashedPage = await s.create(s.ben, { content: embed(first.id) });
      await s.ok(s.ben, `/${trashedPage.id}/archive`, { method: "POST" });
      await s.ok(s.ben, `/${trashedPage.id}`, { method: "DELETE" });
      const taskThere = await taskIn(other.id, embed(first.id));
      // A live task here wins over a live page elsewhere.
      await s.create(s.ben, { content: embed(second.id) }, other.id);
      const taskHere = await taskIn(s.project.id, embed(second.id));
      // With both here, a description comes before a page.
      await s.create(s.ben, { content: embed(third.id) });
      const describer = await taskIn(s.project.id, embed(third.id));

      await purgePage(s, page.id);

      expect(await assetRow(first.id)).toMatchObject({
        taskId: taskThere.id,
        pageId: null,
        projectId: other.id,
      });
      expect(await assetRow(second.id)).toMatchObject({
        taskId: taskHere.id,
        pageId: null,
        projectId: s.project.id,
      });
      expect(await assetRow(third.id)).toMatchObject({
        taskId: describer.id,
        surface: "description",
      });
    });
  });
});
