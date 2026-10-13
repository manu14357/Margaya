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
// versions, backlinks and task references, as the Pages API exposes them.

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
