import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Trash and restore (C7): deleting moves tasks and projects to the trash;
// the trash routes list, restore and delete permanently.

type TrashList = { items: { id: string }[]; total: number };

let world: World;
let project: Project;

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
    // Deleted permanently, the id is unknown: getTask documents 400 for that
    // (a task still in the trash answers 404 above).
    const purged = await expectStatus(
      await admin.get(`/api/task/${task.id}`),
      400,
    );
    expect(purged).toContain("Workspace ID could not be determined");

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
