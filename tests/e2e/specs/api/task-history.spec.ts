import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  signUpUser,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Readable task keys, description history, member activity and the
// timeline's dependency list.

type KeyLookup = { id: string; projectId: string; number: number; key: string };
type Version = { id: string; taskId: string; size: number; preview: string };
type VersionDetail = Version & { content: string };
type Dependencies = {
  relations: {
    id: string;
    sourceTaskId: string;
    targetTaskId: string;
    relationType: string;
  }[];
  truncated: boolean;
};
type ActivityPage = {
  items: { id: string; taskId: string; type: string; task: { id: string } }[];
  nextCursor: string | null;
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("History");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "a readable key resolves to its task inside the workspace only",
  covers("getTaskByKey"),
  async () => {
    const task = await createTask(world.as("owner"), project.id);
    const key = `${project.slug}-${task.number}`;
    const base = `/api/task/by-key/${world.workspace.id}`;

    // Any case, any member.
    const found = await expectJson<KeyLookup>(
      await world.as("viewer").get(`${base}/${key.toLowerCase()}`),
    );
    expect(found).toEqual({
      id: task.id,
      projectId: project.id,
      number: task.number,
      key: key.toUpperCase(),
    });

    await expectStatus(
      await world.as("viewer").get(`${base}/${project.slug}-99999`),
      404,
    );
    await expectStatus(await world.anonymous.get(`${base}/${key}`), 401);
    const outsider = await signUpUser("History outsider");
    try {
      await expectStatus(await outsider.ctx.get(`${base}/${key}`), 403);
    } finally {
      await outsider.ctx.dispose();
    }

    // A trashed task no longer resolves.
    await expectJson(await world.as("owner").delete(`/api/task/${task.id}`));
    await expectStatus(await world.as("viewer").get(`${base}/${key}`), 404);
  },
);

test(
  "description versions are listed, read and restored",
  covers(
    "listTaskDescriptionVersions",
    "getTaskDescriptionVersion",
    "restoreTaskDescriptionVersion",
  ),
  async () => {
    const owner = world.as("owner");
    const task = await createTask(owner, project.id, {
      description: "First draft of the plan",
    });
    await expectJson(
      await owner.put(`/api/task/description/${task.id}`, {
        data: { description: "Second take on the plan" },
      }),
    );

    const versions = await expectJson<Version[]>(
      await world.as("viewer").get(`/api/task/${task.id}/description-versions`),
    );
    // The first change also keeps the text it replaced.
    const original = versions.find((version) =>
      version.preview.includes("First draft"),
    );
    expect(original, JSON.stringify(versions)).toBeTruthy();
    expect(versions.every((version) => version.taskId === task.id)).toBe(true);
    if (!original) return;

    const detail = await expectJson<VersionDetail>(
      await world
        .as("viewer")
        .get(`/api/task/${task.id}/description-versions/${original.id}`),
    );
    expect(detail.content).toContain("First draft of the plan");
    await expectStatus(
      await world
        .as("viewer")
        .get(`/api/task/${task.id}/description-versions/e2e-unknown`),
      404,
    );

    // Viewers read history but cannot restore it.
    const restorePath = `/api/task/${task.id}/description-versions/${original.id}/restore`;
    await expectStatus(await world.as("viewer").post(restorePath), 403);
    const restored = await expectJson<Task & { description: string | null }>(
      await world.as("member").post(restorePath),
    );
    expect(restored.description).toContain("First draft of the plan");

    const after = await expectJson<Version[]>(
      await owner.get(`/api/task/${task.id}/description-versions`),
    );
    expect(after.length).toBeGreaterThan(versions.length);
  },
);

test(
  "a member's activity is listed for other members",
  covers("getMemberActivity"),
  async () => {
    const member = world.users.member;
    const task = await createTask(member.ctx, project.id);
    const path = `/api/activity/member/${member.id}`;
    const params = { workspaceId: world.workspace.id, limit: 50 };

    const page = await expectJson<ActivityPage>(
      await world.as("viewer").get(path, { params }),
    );
    expect(page.items.map((item) => item.taskId)).toContain(task.id);
    expect(page.items.find((item) => item.taskId === task.id)?.task.id).toBe(
      task.id,
    );

    const outsider = await signUpUser("Activity outsider");
    try {
      await expectStatus(
        await world.as("viewer").get(`/api/activity/member/${outsider.id}`, {
          params,
        }),
        404,
      );
    } finally {
      await outsider.ctx.dispose();
    }
    await expectStatus(await world.anonymous.get(path, { params }), 401);
  },
);

test(
  "the timeline lists only ordering relations between the project's tasks",
  covers("getProjectDependencies"),
  async () => {
    const owner = world.as("owner");
    const [a, b, c] = await Promise.all([
      createTask(owner, project.id),
      createTask(owner, project.id),
      createTask(owner, project.id),
    ]);
    const blocks = await expectJson<{ id: string }>(
      await owner.post("/api/task-relation", {
        data: {
          sourceTaskId: a.id,
          targetTaskId: b.id,
          relationType: "blocks",
        },
      }),
    );
    await expectJson(
      await owner.post("/api/task-relation", {
        data: {
          sourceTaskId: a.id,
          targetTaskId: c.id,
          relationType: "related",
        },
      }),
    );

    const dependencies = await expectJson<Dependencies>(
      await world.as("viewer").get(`/api/task-relation/project/${project.id}`),
    );
    expect(dependencies.truncated).toBe(false);
    expect(dependencies.relations).toContainEqual({
      id: blocks.id,
      sourceTaskId: a.id,
      targetTaskId: b.id,
      relationType: "blocks",
    });
    expect(
      dependencies.relations.some((relation) => relation.targetTaskId === c.id),
    ).toBe(false);
  },
);
