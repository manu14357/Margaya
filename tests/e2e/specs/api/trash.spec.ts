import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Json,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Trash and restore (C7): deleting moves tasks, projects and pages to the
// trash; the trash routes list, restore and delete permanently.

type TrashList = { items: { id: string }[]; total: number };
type PageTrashList = {
  items: {
    id: string;
    canManage: boolean;
    deletedBy: { id: string; name: string } | null;
  }[];
  total: number;
};

let world: World;
let project: Project;

/** A page the member made and deleted: only an archived page can be deleted. */
async function newTrashedPage(data: Record<string, unknown> = {}) {
  const member = world.as("member");
  const page = await expectJson(
    await member.post(`/api/page/project/${project.id}`, {
      data: { title: uniqueName("Trashed page"), ...data },
    }),
  );
  await expectJson(await member.post(`/api/page/${page.id}/archive`));
  await expectJson(await member.delete(`/api/page/${page.id}`));
  return page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Trash");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "a deleted task goes to the trash and comes back",
  covers("listTaskTrash", "restoreTask", "purgeTask", "emptyTaskTrash"),
  async () => {
    const admin = world.as("admin");
    const task = await createTask(world.as("owner"), project.id);
    await expectJson<Task>(await admin.delete(`/api/task/${task.id}`));
    await expectStatus(await admin.get(`/api/task/${task.id}`), 404);

    const trash = await expectJson<TrashList>(
      await admin.get(`/api/trash/project/${project.id}/tasks`),
    );
    expect(trash.items.map((item) => item.id)).toContain(task.id);

    // A member can read the trash but not restore.
    await expectStatus(
      await world.as("member").post(`/api/trash/task/${task.id}/restore`),
      403,
    );
    await expectJson<Task>(
      await admin.post(`/api/trash/task/${task.id}/restore`),
    );
    await expectJson<Task>(await admin.get(`/api/task/${task.id}`));

    await expectJson<Task>(await admin.delete(`/api/task/${task.id}`));
    await expectJson<Task>(await admin.delete(`/api/trash/task/${task.id}`));
    // Deleted permanently, the id is unknown, which answers like a task
    // still in the trash.
    const purged = await expectStatus(
      await admin.get(`/api/task/${task.id}`),
      404,
    );
    expect(purged).toContain("Task not found");

    const other = await createTask(world.as("owner"), project.id);
    await expectJson<Task>(await admin.delete(`/api/task/${other.id}`));
    const emptied = await expectJson<{ deletedCount: number }>(
      await admin.post(`/api/trash/project/${project.id}/empty`),
    );
    expect(emptied.deletedCount).toBe(1);
  },
);

test(
  "a deleted project goes to the trash and comes back",
  covers("listProjectTrash", "restoreProject", "purgeProject"),
  async () => {
    const admin = world.as("admin");
    const doomed = await createProject(world.as("owner"), world.workspace.id);
    await expectJson(await admin.delete(`/api/project/${doomed.id}`));

    const trash = await expectJson<TrashList>(
      await admin.get(`/api/trash/projects?workspaceId=${world.workspace.id}`),
    );
    expect(trash.items.map((item) => item.id)).toContain(doomed.id);

    await expectJson(
      await admin.post(`/api/trash/projects/${doomed.id}/restore`),
    );
    await expectJson(await admin.delete(`/api/project/${doomed.id}`));
    await expectJson(await admin.delete(`/api/trash/projects/${doomed.id}`));
    await expectStatus(
      await admin.post(`/api/trash/projects/${doomed.id}/restore`),
      404,
    );
  },
);

test(
  "a deleted page goes to the trash, comes back and can be deleted for good",
  covers("listPageTrash", "restoreDeletedPage", "purgePage"),
  async () => {
    const member = world.as("member");
    const viewer = world.as("viewer");
    const admin = world.as("admin");
    const trashUrl = `/api/trash/project/${project.id}/pages`;

    const page = await newTrashedPage();
    await expectStatus(await member.get(`/api/page/${page.id}`), 404);

    // Anyone with page:read sees it, and its owner may act on it.
    const seenByOwner = await expectJson<PageTrashList>(
      await member.get(trashUrl),
    );
    const entry = seenByOwner.items.find((item) => item.id === page.id);
    expect(entry?.canManage).toBe(true);
    expect(entry?.deletedBy?.id).toBe(world.users.member.id);
    const seenByViewer = await expectJson<PageTrashList>(
      await viewer.get(trashUrl),
    );
    expect(
      seenByViewer.items.find((item) => item.id === page.id)?.canManage,
    ).toBe(false);

    await expectStatus(
      await viewer.post(`/api/trash/page/${page.id}/restore`),
      403,
    );
    await expectStatus(await viewer.delete(`/api/trash/page/${page.id}`), 403);

    // It comes back into the archive, the state it was deleted from.
    const restored = await expectJson<Json & { archivedAt: string | null }>(
      await member.post(`/api/trash/page/${page.id}/restore`),
    );
    expect(restored.archivedAt).not.toBeNull();
    await expectJson(await member.get(`/api/page/${page.id}`));
    const afterRestore = await expectJson<PageTrashList>(
      await member.get(trashUrl),
    );
    expect(afterRestore.items.map((item) => item.id)).not.toContain(page.id);

    // A live page isn't in the trash.
    await expectStatus(
      await member.post(`/api/trash/page/${page.id}/restore`),
      404,
    );
    await expectStatus(await admin.delete(`/api/trash/page/${page.id}`), 404);

    // An admin may delete someone else's page for good.
    await expectJson(await member.delete(`/api/page/${page.id}`));
    const purged = await expectJson<{ id: string; projectId: string | null }>(
      await admin.delete(`/api/trash/page/${page.id}`),
    );
    expect(purged).toEqual({ id: page.id, projectId: project.id });
    await expectStatus(
      await admin.post(`/api/trash/page/${page.id}/restore`),
      404,
    );
    const afterPurge = await expectJson<PageTrashList>(
      await admin.get(trashUrl),
    );
    expect(afterPurge.items.map((item) => item.id)).not.toContain(page.id);

    await expectStatus(
      await member.get("/api/trash/project/e2e-unknown-project/pages"),
      404,
    );
    await expectStatus(
      await member.get(trashUrl, { params: { limit: 0 } }),
      400,
    );
    await expectStatus(await world.anonymous.get(trashUrl), 401);
  },
);

test(
  "a private page stays its owner's in the trash",
  covers("listPageTrash", "restoreDeletedPage", "purgePage"),
  async () => {
    const member = world.as("member");
    const admin = world.as("admin");
    const trashUrl = `/api/trash/project/${project.id}/pages`;
    const secret = await newTrashedPage({ access: "private" });

    const seenByAdmin = await expectJson<PageTrashList>(
      await admin.get(trashUrl),
    );
    expect(seenByAdmin.items.map((item) => item.id)).not.toContain(secret.id);
    await expectStatus(
      await admin.post(`/api/trash/page/${secret.id}/restore`),
      404,
    );
    await expectStatus(await admin.delete(`/api/trash/page/${secret.id}`), 404);

    const seenByOwner = await expectJson<PageTrashList>(
      await member.get(trashUrl),
    );
    expect(seenByOwner.items.map((item) => item.id)).toContain(secret.id);
    await expectJson(await member.delete(`/api/trash/page/${secret.id}`));
  },
);
