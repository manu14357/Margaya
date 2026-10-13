import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers, skipUnlessDeployed } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Saved views: project and workspace views, built-in views, access (shared
// or private), locking, duplication, deletion and the Views feature gate.
// Skipped while the running API predates the views routes.

type View = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string;
  access: "workspace" | "private";
  isLocked: boolean;
  filters: { version: number; root: unknown; archived: string };
  display: { layout: string; groupBy: string | null };
};

const VIEW_OPERATIONS = [
  "listViews",
  "createView",
  "listBuiltInViews",
  "getView",
  "updateView",
  "deleteView",
  "lockView",
  "unlockView",
  "duplicateView",
];

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Views");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test.beforeEach(async () => {
  await skipUnlessDeployed(...VIEW_OPERATIONS);
});

test(
  "create project and workspace views; list, read and run them",
  covers("createView", "listViews", "getView", "listBuiltInViews"),
  async () => {
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const high = await createTask(world.as("owner"), project.id, {
      priority: "high",
    });
    await createTask(world.as("owner"), project.id, { priority: "low" });

    const projectView = await expectJson<View>(
      await member.post("/api/view", {
        data: {
          workspaceId,
          projectId: project.id,
          name: uniqueName("High priority"),
          filters: {
            root: { key: "priority", operator: "in", values: ["high"] },
          },
        },
      }),
    );
    expect(projectView).toMatchObject({
      projectId: project.id,
      access: "workspace",
      isLocked: false,
      filters: {
        version: 1,
        root: { key: "priority", operator: "in", values: ["high"] },
      },
    });

    const workspaceView = await expectJson<View>(
      await member.post("/api/view", {
        data: {
          workspaceId,
          name: uniqueName("Mine"),
          access: "private",
          display: { layout: "board" },
        },
      }),
    );
    expect(workspaceView).toMatchObject({ projectId: null, access: "private" });
    expect(workspaceView.display.layout).toBe("board");

    const projectViews = await expectJson<View[]>(
      await world
        .as("viewer")
        .get("/api/view", { params: { workspaceId, projectId: project.id } }),
    );
    expect(projectViews.map((view) => view.id)).toContain(projectView.id);
    // Private views stay with their owner.
    const viewerWorkspaceViews = await expectJson<View[]>(
      await world.as("viewer").get("/api/view", { params: { workspaceId } }),
    );
    expect(viewerWorkspaceViews.map((view) => view.id)).not.toContain(
      workspaceView.id,
    );
    await expectStatus(
      await world.as("admin").get(`/api/view/${workspaceView.id}`),
      [403, 404],
    );
    const mine = await expectJson<View[]>(
      await member.get("/api/view", { params: { workspaceId, mine: "true" } }),
    );
    expect(mine.map((view) => view.id)).toContain(workspaceView.id);

    const fetched = await expectJson<View>(
      await world.as("viewer").get(`/api/view/${projectView.id}`),
    );
    // Running a view is a task query with its filters.
    const result = await expectJson<{ ids: string[] }>(
      await world.as("viewer").post("/api/task-query", {
        data: {
          workspaceId,
          scope: { projectIds: [project.id] },
          filters: fetched.filters.root,
          archived: fetched.filters.archived,
          mode: "ids",
        },
      }),
    );
    expect(result.ids).toEqual([high.id]);

    const builtIn = await expectJson<{ key: string; name: string }[]>(
      await world
        .as("viewer")
        .get("/api/view/built-in", { params: { workspaceId } }),
    );
    expect(builtIn.map((view) => view.key)).toEqual(
      expect.arrayContaining(["all", "assigned", "created"]),
    );

    await expectStatus(
      await world
        .as("viewer")
        .post("/api/view", { data: { workspaceId, name: "Viewer view" } }),
      403,
    );
    await expectStatus(
      await member.post("/api/view", { data: { workspaceId, name: "   " } }),
      400,
    );
    await expectStatus(
      await member.post("/api/view", {
        data: {
          workspaceId,
          name: "Status in a workspace view",
          filters: {
            root: { key: "status", operator: "in", values: ["to-do"] },
          },
        },
      }),
      400,
    );
  },
);

test(
  "update, lock, duplicate and delete a view",
  covers("updateView", "lockView", "unlockView", "duplicateView", "deleteView"),
  async () => {
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const view = await expectJson<View>(
      await member.post("/api/view", {
        data: {
          workspaceId,
          projectId: project.id,
          name: uniqueName("Editable"),
        },
      }),
    );
    const renamed = uniqueName("Renamed view");
    const updated = await expectJson<View>(
      await member.patch(`/api/view/${view.id}`, {
        data: {
          name: renamed,
          description: "Changed",
          display: { groupBy: "status" },
        },
      }),
    );
    expect(updated).toMatchObject({ name: renamed, description: "Changed" });
    await expectStatus(
      await member.patch(`/api/view/${view.id}`, { data: {} }),
      400,
    );
    // Another member without view:delete cannot change it.
    await expectStatus(
      await world
        .as("viewer")
        .patch(`/api/view/${view.id}`, { data: { name: "Nope" } }),
      403,
    );

    const locked = await expectJson<View>(
      await world.as("admin").post(`/api/view/${view.id}/lock`),
    );
    expect(locked.isLocked).toBe(true);
    await expectStatus(
      await member.patch(`/api/view/${view.id}`, { data: { name: "Locked" } }),
      409,
    );
    await expectStatus(await member.delete(`/api/view/${view.id}`), 409);
    const unlocked = await expectJson<View>(
      await member.post(`/api/view/${view.id}/unlock`),
    );
    expect(unlocked.isLocked).toBe(false);

    const copy = await expectJson<View>(
      await world
        .as("admin")
        .post(`/api/view/${view.id}/duplicate`, { data: {} }),
    );
    expect(copy.id).not.toBe(view.id);
    expect(copy.name).toBe(`${renamed} (copy)`);

    const deleted = await expectJson<{ id: string; projectId: string | null }>(
      await member.delete(`/api/view/${view.id}`),
    );
    expect(deleted).toEqual({ id: view.id, projectId: project.id });
    await expectStatus(await member.get(`/api/view/${view.id}`), 404);
    await expectJson(await world.as("admin").delete(`/api/view/${copy.id}`));
  },
);

test("the Views feature gate answers 403 while the feature is off", async () => {
  const owner = world.as("owner");
  const workspaceId = world.workspace.id;
  const view = await expectJson<View>(
    await owner.post("/api/view", {
      data: { workspaceId, projectId: project.id, name: uniqueName("Gated") },
    }),
  );
  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { viewsEnabled: false },
    }),
  );
  try {
    await expectStatus(
      await owner.get("/api/view", {
        params: { workspaceId, projectId: project.id },
      }),
      403,
    );
    await expectStatus(await owner.get(`/api/view/${view.id}`), 403);
    await expectStatus(
      await owner.post("/api/view", {
        data: { workspaceId, projectId: project.id, name: "Gated 2" },
      }),
      403,
    );
  } finally {
    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { viewsEnabled: true },
      }),
    );
  }
  await expectJson(await owner.get(`/api/view/${view.id}`));
});
