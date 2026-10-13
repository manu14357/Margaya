import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorkspace,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Labels: workspace labels, attaching them to tasks and detaching them, and
// the label permissions (members manage labels, viewers only read).

type Label = {
  id: string;
  name: string;
  color: string;
  taskId: string | null;
  workspaceId: string | null;
};

let world: World;
let project: Project;
let task: Task;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Labels");
  project = await createProject(world.as("owner"), world.workspace.id);
  task = await createTask(world.as("owner"), project.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "create, read, rename and delete a workspace label",
  covers(
    "createLabel",
    "getWorkspaceLabels",
    "getLabel",
    "updateLabel",
    "deleteLabel",
  ),
  async () => {
    const member = world.as("member");
    const name = uniqueName("Label");
    const label = await expectJson<Label>(
      await member.post("/api/label", {
        data: { name, color: "blue", workspaceId: world.workspace.id },
      }),
    );
    expect(label).toMatchObject({
      name,
      color: "blue",
      workspaceId: world.workspace.id,
      taskId: null,
    });

    const labels = await expectJson<Label[]>(
      await world
        .as("viewer")
        .get(`/api/label/workspace/${world.workspace.id}`),
    );
    expect(labels.map((entry) => entry.id)).toContain(label.id);
    const one = await expectJson<Label>(
      await world.as("viewer").get(`/api/label/${label.id}`),
    );
    expect(one.name).toBe(name);

    const renamed = await expectJson<Label>(
      await member.put(`/api/label/${label.id}`, {
        data: { name: `${name} v2`, color: "green" },
      }),
    );
    expect(renamed).toMatchObject({ name: `${name} v2`, color: "green" });

    const deleted = await expectJson<Label>(
      await member.delete(`/api/label/${label.id}`),
      [200],
    );
    expect(deleted.id).toBe(label.id);
    const after = await expectJson<Label[]>(
      await member.get(`/api/label/workspace/${world.workspace.id}`),
    );
    expect(after.map((entry) => entry.id)).not.toContain(label.id);
  },
);

test(
  "attach a label to a task, list the task's labels and detach it",
  covers("attachLabelToTask", "getTaskLabels", "detachLabelFromTask"),
  async () => {
    const member = world.as("member");
    const label = await expectJson<Label>(
      await member.post("/api/label", {
        data: {
          name: uniqueName("Tag"),
          color: "red",
          workspaceId: world.workspace.id,
        },
      }),
    );
    const attached = await expectJson<Label>(
      await member.put(`/api/label/${label.id}/task`, {
        data: { taskId: task.id },
      }),
    );
    expect(attached.name).toBe(label.name);

    const taskLabels = await expectJson<Label[]>(
      await world.as("viewer").get(`/api/label/task/${task.id}`),
    );
    const onTask = taskLabels.find((entry) => entry.name === label.name);
    expect(onTask?.taskId).toBe(task.id);

    // The board carries the label too.
    const board = await expectJson<{
      data: {
        columns: { tasks: { id: string; labels?: { name: string }[] }[] }[];
      };
    }>(await member.get(`/api/task/tasks/${project.id}`));
    const card = board.data.columns
      .flatMap((column) => column.tasks)
      .find((entry) => entry.id === task.id);
    expect(card?.labels?.map((entry) => entry.name)).toContain(label.name);

    const detached = await expectJson<Label>(
      await member.delete(`/api/label/${onTask?.id ?? attached.id}/task`),
    );
    expect(detached.id).toBeTruthy();
    const afterDetach = await expectJson<Label[]>(
      await member.get(`/api/label/task/${task.id}`),
    );
    expect(afterDetach.map((entry) => entry.name)).not.toContain(label.name);
    // Detaching again: the label is no longer on a task.
    await expectStatus(
      await member.delete(`/api/label/${onTask?.id ?? attached.id}/task`),
      [400, 404],
    );
  },
);

test("label roles and validation", async ({ seed }) => {
  const viewer = world.as("viewer");
  const member = world.as("member");
  await expectStatus(
    await viewer.post("/api/label", {
      data: {
        name: "Viewer label",
        color: "red",
        workspaceId: world.workspace.id,
      },
    }),
    403,
  );
  const label = await expectJson<Label>(
    await member.post("/api/label", {
      data: {
        name: uniqueName("Guarded"),
        color: "red",
        workspaceId: world.workspace.id,
      },
    }),
  );
  await expectStatus(
    await viewer.put(`/api/label/${label.id}`, {
      data: { name: "x", color: "red" },
    }),
    403,
  );
  await expectStatus(
    await viewer.put(`/api/label/${label.id}/task`, {
      data: { taskId: task.id },
    }),
    403,
  );
  await expectStatus(await viewer.delete(`/api/label/${label.id}`), 403);
  await expectStatus(
    await member.post("/api/label", {
      data: { color: "red", workspaceId: world.workspace.id },
    }),
    400,
  );
  // A label cannot be attached to a task of another workspace.
  await expectStatus(
    await world.as("owner").put(`/api/label/${label.id}/task`, {
      data: { taskId: seed.projects.web.tasks.hero.id },
    }),
    [400, 403],
  );
  // Nor attached to a task that does not exist.
  await expectStatus(
    await member.put(`/api/label/${label.id}/task`, {
      data: { taskId: "e2e-unknown-task" },
    }),
    [400, 404],
  );
});

test("labels of another workspace stay private", async () => {
  const outsiderWorkspace = await createWorkspace(
    world.users.viewer.ctx,
    "E2E Labels other",
  );
  try {
    await expectStatus(
      await world
        .as("member")
        .get(`/api/label/workspace/${outsiderWorkspace.id}`),
      403,
    );
  } finally {
    await world.users.viewer.ctx.post("/api/auth/organization/delete", {
      data: { organizationId: outsiderWorkspace.id },
    });
    await world.users.viewer.ctx.post("/api/auth/organization/set-active", {
      data: { organizationId: world.workspace.id },
    });
  }
});
