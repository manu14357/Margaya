import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  uniqueSlug,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Projects: CRUD, ordering, archive, feature flags and public boards, with the
// role matrix (viewer reads only; member creates but cannot update or delete).

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Projects");
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "create, read, list, update and delete a project",
  covers(
    "createProject",
    "getProject",
    "listProjects",
    "updateProject",
    "deleteProject",
  ),
  async () => {
    const owner = world.as("owner");
    const name = uniqueName("Project");
    const slug = uniqueSlug("P");
    const project = await expectJson<Project>(
      await owner.post("/api/project", {
        data: { name, slug, icon: "Layout", workspaceId: world.workspace.id },
      }),
    );
    expect(project).toMatchObject({
      name,
      slug,
      icon: "Layout",
      workspaceId: world.workspace.id,
      archivedAt: null,
      isPublic: false,
      lastTaskNumber: 0,
      cyclesEnabled: true,
      modulesEnabled: true,
    });

    const fetched = await expectJson<Project>(
      await world.as("viewer").get(`/api/project/${project.id}`),
    );
    expect(fetched.id).toBe(project.id);

    const listed = await expectJson<Project[]>(
      await world.as("member").get("/api/project", {
        params: { workspaceId: world.workspace.id },
      }),
    );
    expect(listed.map((entry) => entry.id)).toContain(project.id);

    const newName = uniqueName("Project renamed");
    const updated = await expectJson<Project>(
      await world.as("admin").put(`/api/project/${project.id}`, {
        data: {
          name: newName,
          icon: "Rocket",
          slug,
          description: "Updated over HTTP",
          isPublic: false,
        },
      }),
    );
    expect(updated).toMatchObject({
      name: newName,
      icon: "Rocket",
      description: "Updated over HTTP",
    });

    const deleted = await expectJson<Project>(
      await owner.delete(`/api/project/${project.id}`),
    );
    expect(deleted.id).toBe(project.id);
    await expectStatus(
      await owner.get(`/api/project/${project.id}`),
      [400, 404],
    );
  },
);

test("project roles: viewer cannot create; member cannot update or delete", async () => {
  const body = {
    name: uniqueName("Denied"),
    slug: uniqueSlug("D"),
    icon: "Layout",
    workspaceId: world.workspace.id,
  };
  await expectStatus(
    await world.as("viewer").post("/api/project", { data: body }),
    403,
  );

  // Members hold project:create...
  const project = await expectJson<Project>(
    await world.as("member").post("/api/project", { data: body }),
  );
  // ...but neither project:update nor project:delete.
  await expectStatus(
    await world.as("member").put(`/api/project/${project.id}`, {
      data: {
        name: "Nope",
        icon: "Layout",
        slug: project.slug,
        description: "",
        isPublic: false,
      },
    }),
    403,
  );
  await expectStatus(
    await world.as("member").patch(`/api/project/${project.id}/features`, {
      data: { cyclesEnabled: false },
    }),
    403,
  );
  await expectStatus(
    await world.as("member").put(`/api/project/${project.id}/archive`),
    403,
  );
  await expectStatus(
    await world.as("member").delete(`/api/project/${project.id}`),
    403,
  );
  await expectStatus(
    await world.as("anonymous").get(`/api/project/${project.id}`),
    401,
  );
  await expectJson(
    await world.as("owner").delete(`/api/project/${project.id}`),
  );
});

test("project validation: missing fields, duplicate keys and unknown ids", async () => {
  const owner = world.as("owner");
  const missingName = await expectStatus(
    await owner.post("/api/project", {
      data: {
        slug: uniqueSlug(),
        icon: "Layout",
        workspaceId: world.workspace.id,
      },
    }),
    400,
  );
  expect(missingName).toMatch(/name/i);

  const project = await createProject(owner, world.workspace.id);
  // Keys are unique per workspace, ignoring case.
  await expectStatus(
    await owner.post("/api/project", {
      data: {
        name: uniqueName("Duplicate"),
        slug: project.slug.toLowerCase(),
        icon: "Layout",
        workspaceId: world.workspace.id,
      },
    }),
    409,
  );
  await expectStatus(await owner.get("/api/project/e2e-unknown-project"), 400);
  await expectStatus(
    await owner.get("/api/project", {
      params: { workspaceId: "e2e-unknown-workspace" },
    }),
    403,
  );
  await expectJson(await owner.delete(`/api/project/${project.id}`));
});

test(
  "archive and unarchive a project",
  covers("archiveProject", "unarchiveProject"),
  async () => {
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);

    const archived = await expectJson<Project & { archivedAt: string | null }>(
      await world.as("admin").put(`/api/project/${project.id}/archive`),
    );
    expect(archived.archivedAt).not.toBeNull();

    const active = await expectJson<Project[]>(
      await owner.get("/api/project", {
        params: { workspaceId: world.workspace.id },
      }),
    );
    expect(active.map((entry) => entry.id)).not.toContain(project.id);
    const all = await expectJson<Project[]>(
      await owner.get("/api/project", {
        params: { workspaceId: world.workspace.id, includeArchived: "true" },
      }),
    );
    expect(all.map((entry) => entry.id)).toContain(project.id);

    const restored = await expectJson<Project & { archivedAt: string | null }>(
      await world.as("admin").put(`/api/project/${project.id}/unarchive`),
    );
    expect(restored.archivedAt).toBeNull();
    await expectJson(await owner.delete(`/api/project/${project.id}`));
  },
);

test("reorder projects", covers("reorderProjects"), async () => {
  const owner = world.as("owner");
  const first = await createProject(owner, world.workspace.id);
  const second = await createProject(owner, world.workspace.id);

  const reordered = await expectJson<Project[]>(
    await owner.put("/api/project/reorder", {
      params: { workspaceId: world.workspace.id },
      data: {
        projects: [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
        ],
      },
    }),
  );
  const ids = reordered.map((entry) => entry.id);
  expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  const listed = await expectJson<Project[]>(
    await owner.get("/api/project", {
      params: { workspaceId: world.workspace.id },
    }),
  );
  const listedIds = listed.map((entry) => entry.id);
  expect(listedIds.indexOf(second.id)).toBeLessThan(
    listedIds.indexOf(first.id),
  );

  await expectStatus(
    await owner.put("/api/project/reorder", {
      params: { workspaceId: world.workspace.id },
      data: { projects: [] },
    }),
    400,
  );
  await expectStatus(
    await world.as("member").put("/api/project/reorder", {
      params: { workspaceId: world.workspace.id },
      data: { projects: [{ id: first.id, position: 0 }] },
    }),
    403,
  );
  for (const project of [first, second]) {
    await expectJson(await owner.delete(`/api/project/${project.id}`));
  }
});

test(
  "toggle project features; an empty or unknown flag is rejected",
  covers("updateProjectFeatures"),
  async () => {
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);
    const updated = await expectJson<Project>(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { cyclesEnabled: false, estimatesEnabled: true },
      }),
    );
    expect(updated).toMatchObject({
      cyclesEnabled: false,
      estimatesEnabled: true,
      // Flags that were not sent keep their value.
      modulesEnabled: true,
    });
    await expectStatus(
      await owner.patch(`/api/project/${project.id}/features`, { data: {} }),
      400,
    );
    await expectStatus(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { teleportEnabled: true },
      }),
      400,
    );
    await expectStatus(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { cyclesEnabled: "yes" },
      }),
      400,
    );
    await expectJson(await owner.delete(`/api/project/${project.id}`));
  },
);

test(
  "a public project's board and descriptions are readable without signing in",
  covers(
    "getPublicProject",
    "getPublicProjectDescriptionPage",
    "getPublicTaskDescriptionPage",
  ),
  async () => {
    const owner = world.as("owner");
    const anonymous = world.as("anonymous");
    const project = await createProject(owner, world.workspace.id);
    const task = await createTask(owner, project.id, {
      title: uniqueName("Public task"),
      description: "A task description anyone may read.",
    });

    // Unpublished first: the same 404 as an unknown board.
    await expectStatus(
      await anonymous.get(`/api/public-project/${project.id}`),
      404,
    );

    await expectJson(
      await owner.put(`/api/project/${project.id}`, {
        data: {
          name: project.name,
          icon: "Layout",
          slug: project.slug,
          description: "The public project description.",
          isPublic: true,
        },
      }),
    );

    const board = await expectJson<{
      id: string;
      isPublic: boolean;
      columns: { slug: string; tasks: { id: string; title: string }[] }[];
      pagination: { total: number };
    }>(await anonymous.get(`/api/public-project/${project.id}`));
    expect(board.isPublic).toBe(true);
    const toDo = board.columns.find((column) => column.slug === "to-do");
    expect(toDo?.tasks.map((entry) => entry.id)).toContain(task.id);
    expect(board.pagination.total).toBe(1);

    const projectDescription = await expectJson<{
      content: string;
      version: string;
      nextOffset: number | null;
    }>(await anonymous.get(`/api/public-project/${project.id}/description`));
    expect(projectDescription.content).toBe("The public project description.");
    expect(projectDescription.nextOffset).toBeNull();

    const taskDescription = await expectJson<{
      content: string;
      version: string;
    }>(
      await anonymous.get(
        `/api/public-project/${project.id}/task/${task.id}/description`,
      ),
    );
    expect(taskDescription.content).toBe("A task description anyone may read.");

    await expectStatus(
      await anonymous.get(`/api/public-project/${project.id}`, {
        params: { page: "zero" },
      }),
      400,
    );
    await expectStatus(
      await anonymous.get(
        `/api/public-project/${project.id}/task/e2e-unknown/description`,
      ),
      404,
    );

    // Back to private: the board closes again.
    await expectJson(
      await owner.put(`/api/project/${project.id}`, {
        data: {
          name: project.name,
          icon: "Layout",
          slug: project.slug,
          description: "",
          isPublic: false,
        },
      }),
    );
    await expectStatus(
      await anonymous.get(`/api/public-project/${project.id}`),
      404,
    );
    await expectStatus(
      await anonymous.get(`/api/public-project/${project.id}/description`),
      404,
    );
    await expectJson(await owner.delete(`/api/project/${project.id}`));
  },
);
