import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Json,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Pages: create, read, edit, tree moves, locks, access, archive, duplicate,
// versions, backlinks, task references, comments and watching, as the Pages API
// exposes them.

type Page = Json & {
  projectId: string | null;
  parentId: string | null;
  title: string;
  access: "public" | "private";
  isLocked: boolean;
  archivedAt: string | null;
  isFullWidth: boolean;
  contentMarkdown?: string;
  capabilities: Record<string, boolean>;
};
type Version = Json & {
  pageId: string;
  title: string;
  contentMarkdown?: string;
};
type PageComment = {
  id: string;
  pageId: string;
  userId: string | null;
  content: string;
  user: { name: string; image: string | null } | null;
  canEdit: boolean;
  canDelete: boolean;
};
type PageWatch = { pageId: string; subscribed: boolean };

let world: World;
let project: Project;
let other: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Pages");
  project = await createProject(world.as("owner"), world.workspace.id);
  other = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

async function newPage(data: Record<string, unknown> = {}): Promise<Page> {
  return expectJson<Page>(
    await world.as("member").post(`/api/page/project/${project.id}`, {
      data: { title: uniqueName("Page"), ...data },
    }),
  );
}

test(
  "create, read, list, rename, rewrite and delete a page",
  covers(
    "createPage",
    "getPage",
    "listPages",
    "updatePage",
    "replacePageContent",
    "deletePage",
  ),
  async () => {
    const member = world.as("member");
    const page = await newPage({ content: "# Plan\n\nFirst draft." });
    expect(page.projectId).toBe(project.id);
    expect(page.capabilities.canEdit).toBe(true);

    const read = await expectJson<Page>(
      await member.get(`/api/page/${page.id}`),
    );
    expect(read.title).toBe(page.title);
    expect(read.contentMarkdown).toContain("First draft.");

    const listed = await expectJson<Page[]>(
      await world.as("viewer").get(`/api/page/project/${project.id}`),
    );
    expect(listed.map((entry) => entry.id)).toContain(page.id);

    const renamed = await expectJson<Page>(
      await member.patch(`/api/page/${page.id}`, {
        data: { title: "Release plan", isFullWidth: true },
      }),
    );
    expect(renamed).toMatchObject({ title: "Release plan", isFullWidth: true });

    await expectJson(
      await member.put(`/api/page/${page.id}/content`, {
        data: { markdown: "# Plan\n\nSecond draft." },
      }),
    );
    const rewritten = await expectJson<Page>(
      await member.get(`/api/page/${page.id}`),
    );
    expect(rewritten.contentMarkdown).toContain("Second draft.");

    // A viewer reads but never writes.
    await expectStatus(
      await world.as("viewer").patch(`/api/page/${page.id}`, {
        data: { title: "Hijacked" },
      }),
      403,
    );

    // Only an archived page can be deleted.
    await expectStatus(await member.delete(`/api/page/${page.id}`), 409);
    await expectJson(await member.post(`/api/page/${page.id}/archive`));
    await expectJson(await member.delete(`/api/page/${page.id}`));
    await expectStatus(await member.get(`/api/page/${page.id}`), 404);
  },
);

test(
  "nest, lock, restrict, archive, duplicate and move a page",
  covers(
    "movePageInTree",
    "lockPage",
    "unlockPage",
    "updatePageAccess",
    "archivePage",
    "unarchivePage",
    "duplicatePage",
    "movePageToProject",
  ),
  async () => {
    const member = world.as("member");
    const parent = await newPage();
    const child = await newPage();

    await expectJson(
      await member.put(`/api/page/${child.id}/position`, {
        data: { parentId: parent.id, afterId: null },
      }),
    );
    const nested = await expectJson<Page>(
      await member.get(`/api/page/${child.id}`),
    );
    expect(nested.parentId).toBe(parent.id);
    await expectJson(
      await member.put(`/api/page/${child.id}/position`, {
        data: { parentId: null },
      }),
    );
    expect(
      (await expectJson<Page>(await member.get(`/api/page/${child.id}`)))
        .parentId,
    ).toBeNull();

    const locked = await expectJson<Page>(
      await member.post(`/api/page/${child.id}/lock`),
    );
    expect(locked.isLocked).toBe(true);
    const unlocked = await expectJson<Page>(
      await member.delete(`/api/page/${child.id}/lock`),
    );
    expect(unlocked.isLocked).toBe(false);

    const restricted = await expectJson<Page>(
      await member.put(`/api/page/${child.id}/access`, {
        data: { access: "private" },
      }),
    );
    expect(restricted.access).toBe("private");
    await expectStatus(
      await world.as("admin").get(`/api/page/${child.id}`),
      [403, 404],
    );
    const shared = await expectJson<Page>(
      await member.put(`/api/page/${child.id}/access`, {
        data: { access: "public" },
      }),
    );
    expect(shared.access).toBe("public");

    const archived = await expectJson<Page>(
      await member.post(`/api/page/${child.id}/archive`),
    );
    expect(archived.archivedAt).not.toBeNull();
    const restored = await expectJson<Page>(
      await member.post(`/api/page/${child.id}/unarchive`),
    );
    expect(restored.archivedAt).toBeNull();

    const copy = await expectJson<Page>(
      await member.post(`/api/page/${child.id}/duplicate`),
    );
    expect(copy.id).not.toBe(child.id);
    expect(copy.projectId).toBe(project.id);

    const moved = await expectJson<Page>(
      await member.post(`/api/page/${copy.id}/move`, {
        data: { projectId: other.id },
      }),
    );
    expect(moved.projectId).toBe(other.id);
    const otherPages = await expectJson<Page[]>(
      await member.get(`/api/page/project/${other.id}`),
    );
    expect(otherPages.map((entry) => entry.id)).toContain(copy.id);
  },
);

test(
  "versions, backlinks and task references",
  covers(
    "listPageVersions",
    "getPageVersion",
    "restorePageVersion",
    "listPageBacklinks",
    "listTaskPageReferences",
  ),
  async () => {
    const owner = world.as("owner");
    const target = await newPage({ content: "Version one." });
    await expectJson(
      await owner.put(`/api/page/${target.id}/content`, {
        data: { markdown: "Version two." },
      }),
    );

    const versions = await expectJson<Version[]>(
      await owner.get(`/api/page/${target.id}/versions`),
    );
    for (const version of versions) expect(version.pageId).toBe(target.id);
    if (versions[0]) {
      const version = await expectJson<Version>(
        await owner.get(`/api/page/${target.id}/versions/${versions[0].id}`),
      );
      expect(typeof version.contentMarkdown).toBe("string");
      await expectJson(
        await owner.post(
          `/api/page/${target.id}/versions/${versions[0].id}/restore`,
        ),
      );
    }
    await expectStatus(
      await owner.get(`/api/page/${target.id}/versions/e2e-unknown-version`),
      404,
    );

    const backlinks = await expectJson<Page[]>(
      await owner.get(`/api/page/${target.id}/backlinks`),
    );
    expect(Array.isArray(backlinks)).toBe(true);

    const task = await createTask(owner, project.id);
    const references = await expectJson<Page[]>(
      await owner.get(`/api/page/task/${task.id}/references`),
    );
    expect(references).toEqual([]);
  },
);

test(
  "comment on a page: add, read, edit and delete",
  covers(
    "listPageComments",
    "createPageComment",
    "updatePageComment",
    "deletePageComment",
  ),
  async () => {
    const member = world.as("member");
    const viewer = world.as("viewer");
    const admin = world.as("admin");
    const page = await newPage();
    const comments = `/api/page/${page.id}/comments`;

    const comment = await expectJson<PageComment>(
      await member.post(comments, { data: { content: "First thought." } }),
    );
    expect(comment).toMatchObject({
      pageId: page.id,
      userId: world.users.member.id,
      content: "First thought.",
      canEdit: true,
      canDelete: true,
    });

    // A viewer reads comments but doesn't write them.
    const seen = await expectJson<PageComment[]>(await viewer.get(comments));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id: comment.id,
      user: { name: world.users.member.name },
      canEdit: false,
      canDelete: false,
    });
    await expectStatus(
      await viewer.post(comments, { data: { content: "Viewer note" } }),
      403,
    );
    await expectStatus(await world.anonymous.get(comments), 401);
    await expectStatus(
      await member.post(comments, { data: { content: "   " } }),
      400,
    );

    const edited = await expectJson<PageComment>(
      await member.put(`${comments}/${comment.id}`, {
        data: { content: "Second thought." },
      }),
    );
    expect(edited.content).toBe("Second thought.");
    // Only the author edits, an admin included.
    await expectStatus(
      await admin.put(`${comments}/${comment.id}`, {
        data: { content: "Moderated" },
      }),
      403,
    );
    await expectStatus(
      await member.put(`${comments}/e2e-unknown-comment`, {
        data: { content: "Nowhere" },
      }),
      404,
    );

    await expectStatus(await viewer.delete(`${comments}/${comment.id}`), 403);
    const removed = await expectJson<{ id: string; pageId: string }>(
      await member.delete(`${comments}/${comment.id}`),
    );
    expect(removed).toEqual({ id: comment.id, pageId: page.id });
    await expectStatus(await member.delete(`${comments}/${comment.id}`), 404);

    // An admin may remove someone else's comment.
    const moderated = await expectJson<PageComment>(
      await member.post(comments, { data: { content: "Off topic." } }),
    );
    await expectJson(await admin.delete(`${comments}/${moderated.id}`));
    expect(await expectJson<PageComment[]>(await member.get(comments))).toEqual(
      [],
    );
  },
);

test(
  "page comments follow the page: locked is fine, archived is not, private stays private",
  covers("listPageComments", "createPageComment", "updatePageComment"),
  async () => {
    const member = world.as("member");
    const admin = world.as("admin");
    const page = await newPage();
    const comments = `/api/page/${page.id}/comments`;

    await expectJson(await member.post(`/api/page/${page.id}/lock`));
    const comment = await expectJson<PageComment>(
      await member.post(comments, { data: { content: "Still open." } }),
    );
    await expectJson(await member.delete(`/api/page/${page.id}/lock`));

    await expectJson(await member.post(`/api/page/${page.id}/archive`));
    await expectStatus(
      await member.post(comments, { data: { content: "Too late." } }),
      409,
    );
    await expectStatus(
      await member.put(`${comments}/${comment.id}`, {
        data: { content: "Too late." },
      }),
      409,
    );
    const archived = await expectJson<PageComment[]>(
      await member.get(comments),
    );
    expect(archived.map((entry) => entry.id)).toEqual([comment.id]);

    const secret = await newPage({ access: "private" });
    const secretComments = `/api/page/${secret.id}/comments`;
    await expectJson(
      await member.post(secretComments, { data: { content: "Just for me." } }),
    );
    await expectStatus(await admin.get(secretComments), 404);
    await expectStatus(
      await admin.post(secretComments, { data: { content: "Hello?" } }),
      404,
    );
  },
);

test(
  "watch and unwatch a page",
  covers("getPageSubscription", "subscribeToPage", "unsubscribeFromPage"),
  async () => {
    // The member owns pages made with newPage().
    const member = world.as("member");
    const viewer = world.as("viewer");
    const page = await newPage();
    const url = `/api/page/${page.id}/subscription`;
    const watching = { pageId: page.id, subscribed: true };
    const notWatching = { pageId: page.id, subscribed: false };

    expect(await expectJson<PageWatch>(await member.get(url))).toEqual(
      watching,
    );
    expect(await expectJson<PageWatch>(await viewer.get(url))).toEqual(
      notWatching,
    );

    // page:read is enough, and repeating either call changes nothing.
    for (const _ of [1, 2]) {
      expect(await expectJson<PageWatch>(await viewer.put(url))).toEqual(
        watching,
      );
    }
    expect(await expectJson<PageWatch>(await viewer.get(url))).toEqual(
      watching,
    );
    for (const _ of [1, 2]) {
      expect(await expectJson<PageWatch>(await viewer.delete(url))).toEqual(
        notWatching,
      );
    }

    // The owner can stop watching too; commenting starts it again.
    expect(await expectJson<PageWatch>(await member.delete(url))).toEqual(
      notWatching,
    );
    await expectJson(
      await member.post(`/api/page/${page.id}/comments`, {
        data: { content: "Back on this." },
      }),
    );
    expect(await expectJson<PageWatch>(await member.get(url))).toEqual(
      watching,
    );

    const secret = await newPage({ access: "private" });
    await expectStatus(
      await viewer.get(`/api/page/${secret.id}/subscription`),
      404,
    );
    await expectStatus(
      await viewer.put(`/api/page/${secret.id}/subscription`),
      404,
    );
    await expectStatus(
      await viewer.delete("/api/page/e2e-unknown-page/subscription"),
      404,
    );
    await expectStatus(await world.anonymous.get(url), 401);
  },
);

test(
  "page asset uploads need object storage",
  covers("createPageAssetUpload", "finalizePageAssetUpload"),
  async () => {
    // The e2e API runs without S3-compatible storage.
    const page = await newPage();
    const member = world.as("member");
    await expectStatus(
      await member.put(`/api/page/${page.id}/asset-upload`, {
        data: { filename: "diagram.png", contentType: "image/png", size: 1024 },
      }),
      503,
    );
    await expectStatus(
      await member.post(`/api/page/${page.id}/asset-upload/finalize`, {
        data: {
          key: "someone-elses/key.png",
          filename: "diagram.png",
          contentType: "image/png",
          size: 1024,
        },
      }),
      [400, 503],
    );
  },
);
