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
import { uniqueName } from "../../helpers/ui";

// Modules: CRUD and ordering, task membership from both sides, progress,
// links, archive rules, delete permissions and the Modules feature gate.

type Module = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  leadId: string | null;
  memberIds: string[];
  position: number;
  archivedAt: string | null;
  counts: { total: number };
};
type ModuleLink = {
  id: string;
  moduleId: string;
  url: string;
  title: string | null;
};
type Membership = {
  moduleId: string;
  added: string[];
  removed: string[];
  unchanged: string[];
  ignored: string[];
};

let world: World;
let project: Project;
let tasks: Task[];
let alpha: Module;
let beta: Module;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Modules");
  const owner = world.as("owner");
  project = await createProject(owner, world.workspace.id);
  tasks = [
    await createTask(owner, project.id, { status: "to-do" }),
    await createTask(owner, project.id, { status: "done" }),
  ];
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "create, list, read and update modules",
  covers("createModule", "listModules", "getModule", "updateModule"),
  async () => {
    const member = world.as("member");
    alpha = await expectJson<Module>(
      await member.post(`/api/module/project/${project.id}`, {
        data: {
          name: uniqueName("Alpha module"),
          description: "The first module",
          status: "planned",
          leadId: world.users.admin.id,
          memberIds: [world.users.member.id],
          startDate: "2031-01-01",
          targetDate: "2031-02-01",
        },
      }),
    );
    expect(alpha).toMatchObject({
      status: "planned",
      leadId: world.users.admin.id,
      memberIds: [world.users.member.id],
    });
    beta = await expectJson<Module>(
      await member.post(`/api/module/project/${project.id}`, {
        data: { name: uniqueName("Beta module") },
      }),
    );
    expect(beta.status).toBe("backlog");

    const listed = await expectJson<Module[]>(
      await world.as("viewer").get(`/api/module/project/${project.id}`),
    );
    // New modules go on top.
    expect(listed.map((entry) => entry.id)).toEqual([beta.id, alpha.id]);
    const byLead = await expectJson<Module[]>(
      await world.as("viewer").get(`/api/module/project/${project.id}`, {
        params: { leadId: world.users.admin.id },
      }),
    );
    expect(byLead.map((entry) => entry.id)).toEqual([alpha.id]);

    const fetched = await expectJson<Module & { links: unknown[] }>(
      await world.as("viewer").get(`/api/module/${alpha.id}`),
    );
    expect(fetched.name).toBe(alpha.name);

    const renamed = uniqueName("Alpha renamed");
    const updated = await expectJson<Module>(
      await member.put(`/api/module/${alpha.id}`, {
        data: {
          name: renamed,
          status: "in-progress",
          leadId: null,
          memberIds: [],
        },
      }),
    );
    expect(updated).toMatchObject({
      name: renamed,
      status: "in-progress",
      leadId: null,
      memberIds: [],
    });
    alpha = updated;

    await expectStatus(
      await member.post(`/api/module/project/${project.id}`, {
        data: { name: renamed },
      }),
      409,
    );
    await expectStatus(
      await member.post(`/api/module/project/${project.id}`, {
        data: { name: uniqueName("Bad status"), status: "someday" },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").post(`/api/module/project/${project.id}`, {
        data: { name: uniqueName("Viewer module") },
      }),
      403,
    );
  },
);

test("reorder modules", covers("reorderModules"), async () => {
  const reordered = await expectJson<Module[]>(
    await world.as("member").put(`/api/module/project/${project.id}/reorder`, {
      data: {
        modules: [
          { id: alpha.id, position: 0 },
          { id: beta.id, position: 1 },
        ],
      },
    }),
  );
  expect(reordered.map((entry) => entry.id)).toEqual([alpha.id, beta.id]);
  await expectStatus(
    await world.as("member").put(`/api/module/project/${project.id}/reorder`, {
      data: {
        modules: [
          { id: alpha.id, position: 0 },
          { id: alpha.id, position: 1 },
        ],
      },
    }),
    400,
  );
});

test(
  "module tasks from the module and from the task",
  covers(
    "addModuleTasks",
    "listModuleTasks",
    "removeModuleTasks",
    "getTaskModules",
    "setTaskModules",
    "getModuleTaskMap",
  ),
  async () => {
    const member = world.as("member");
    const [open, done] = tasks;
    const added = await expectJson<Membership>(
      await member.post(`/api/module/${alpha.id}/tasks`, {
        data: { taskIds: [open?.id, done?.id, "e2e-unknown-task"] },
      }),
    );
    expect(added.added.sort()).toEqual([open?.id, done?.id].sort());
    expect(added.ignored).toEqual(["e2e-unknown-task"]);

    const page = await expectJson<{
      tasks: { id: string }[];
      pagination: { total: number; totalPages: number };
    }>(
      await world
        .as("viewer")
        .get(`/api/module/${alpha.id}/tasks`, { params: { limit: "1" } }),
    );
    expect(page.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect(page.tasks).toHaveLength(1);

    const setResult = await expectJson<{ id: string; name: string }[]>(
      await member.put(`/api/module/task/${open?.id}`, {
        data: { addModuleIds: [beta.id], removeModuleIds: [alpha.id] },
      }),
    );
    expect(setResult.map((entry) => entry.id)).toEqual([beta.id]);
    const taskModules = await expectJson<{ id: string }[]>(
      await world.as("viewer").get(`/api/module/task/${open?.id}`),
    );
    expect(taskModules.map((entry) => entry.id)).toEqual([beta.id]);

    const map = await expectJson<{ taskId: string; moduleId: string }[]>(
      await world
        .as("viewer")
        .get(`/api/module/project/${project.id}/task-map`),
    );
    expect(map).toEqual(
      expect.arrayContaining([
        { taskId: open?.id, moduleId: beta.id },
        { taskId: done?.id, moduleId: alpha.id },
      ]),
    );

    const removed = await expectJson<Membership>(
      await member.delete(`/api/module/${alpha.id}/tasks`, {
        data: { taskIds: [done?.id] },
      }),
    );
    expect(removed.removed).toEqual([done?.id]);

    await expectStatus(
      await member.put(`/api/module/task/${open?.id}`, { data: {} }),
      400,
    );
    await expectStatus(
      await member.put(`/api/module/task/${open?.id}`, {
        data: { addModuleIds: [beta.id], removeModuleIds: [beta.id] },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").post(`/api/module/${alpha.id}/tasks`, {
        data: { taskIds: [done?.id] },
      }),
      403,
    );
  },
);

test("module progress", covers("getModuleProgress"), async () => {
  await expectJson(
    await world.as("member").post(`/api/module/${alpha.id}/tasks`, {
      data: { taskIds: [tasks[1]?.id] },
    }),
  );
  const progress = await expectJson<{
    moduleId: string;
    counts: { total: number; completed: number };
    progress: number;
  }>(await world.as("viewer").get(`/api/module/${alpha.id}/progress`));
  expect(progress.moduleId).toBe(alpha.id);
  expect(progress.counts).toMatchObject({ total: 1, completed: 1 });
  expect(progress.progress).toBe(100);
});

test(
  "module links",
  covers(
    "listModuleLinks",
    "createModuleLink",
    "updateModuleLink",
    "deleteModuleLink",
  ),
  async () => {
    const member = world.as("member");
    const link = await expectJson<ModuleLink>(
      await member.post(`/api/module/${alpha.id}/links`, {
        data: { url: "example.com/spec", title: "Spec" },
      }),
    );
    // https:// is assumed.
    expect(link).toMatchObject({
      moduleId: alpha.id,
      url: "https://example.com/spec",
      title: "Spec",
    });
    await expectStatus(
      await member.post(`/api/module/${alpha.id}/links`, {
        data: { url: "https://example.com/spec" },
      }),
      409,
    );
    await expectStatus(
      await member.post(`/api/module/${alpha.id}/links`, {
        data: { url: "javascript:alert(1)" },
      }),
      400,
    );

    const updated = await expectJson<ModuleLink>(
      await member.put(`/api/module/${alpha.id}/links/${link.id}`, {
        data: { title: null },
      }),
    );
    expect(updated.title).toBeNull();

    const links = await expectJson<ModuleLink[]>(
      await world.as("viewer").get(`/api/module/${alpha.id}/links`),
    );
    expect(links.map((entry) => entry.id)).toEqual([link.id]);

    const deleted = await expectJson<{ id: string }>(
      await member.delete(`/api/module/${alpha.id}/links/${link.id}`),
    );
    expect(deleted.id).toBe(link.id);
    await expectStatus(
      await member.delete(`/api/module/${alpha.id}/links/${link.id}`),
      404,
    );
  },
);

test(
  "archive rules: only completed or cancelled modules, read-only while archived",
  covers("archiveModule", "unarchiveModule"),
  async () => {
    const member = world.as("member");
    await expectStatus(
      await member.post(`/api/module/${beta.id}/archive`),
      400,
    );
    await expectJson(
      await member.put(`/api/module/${beta.id}`, {
        data: { status: "cancelled" },
      }),
    );
    const archived = await expectJson<Module>(
      await member.post(`/api/module/${beta.id}/archive`),
    );
    expect(archived.archivedAt).not.toBeNull();
    await expectStatus(
      await member.put(`/api/module/${beta.id}`, {
        data: { name: "Changed while archived" },
      }),
      409,
    );
    await expectStatus(
      await member.post(`/api/module/${beta.id}/links`, {
        data: { url: "https://example.com" },
      }),
      409,
    );
    const archivedList = await expectJson<Module[]>(
      await member.get(`/api/module/project/${project.id}`, {
        params: { view: "archived" },
      }),
    );
    expect(archivedList.map((entry) => entry.id)).toEqual([beta.id]);

    const restored = await expectJson<Module>(
      await member.post(`/api/module/${beta.id}/unarchive`),
    );
    expect(restored.archivedAt).toBeNull();
  },
);

test(
  "delete a module: creator or module:delete",
  covers("deleteModule"),
  async () => {
    // The owner created no module; an admin module the member did not create.
    const adminModule = await expectJson<Module>(
      await world.as("admin").post(`/api/module/project/${project.id}`, {
        data: { name: uniqueName("Admin module") },
      }),
    );
    await expectStatus(
      await world.as("member").delete(`/api/module/${adminModule.id}`),
      403,
    );
    const removed = await expectJson<{ id: string; removedTaskIds: string[] }>(
      await world.as("member").delete(`/api/module/${alpha.id}`),
    );
    expect(removed.id).toBe(alpha.id);
    await expectJson(
      await world.as("owner").delete(`/api/module/${adminModule.id}`),
    );
    await expectStatus(
      await world.as("owner").get(`/api/module/${alpha.id}`),
      404,
    );
  },
);

test("the Modules feature gate answers 403 while the feature is off", async () => {
  const owner = world.as("owner");
  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { modulesEnabled: false },
    }),
  );
  try {
    await expectStatus(
      await owner.get(`/api/module/project/${project.id}`),
      403,
    );
    await expectStatus(
      await owner.post(`/api/module/project/${project.id}`, {
        data: { name: "Gated" },
      }),
      403,
    );
    await expectStatus(await owner.get(`/api/module/${beta.id}`), 403);
    await expectStatus(
      await owner.get(`/api/module/task/${tasks[0]?.id}`),
      403,
    );
    await expectStatus(
      await owner.get(`/api/module/project/${project.id}/task-map`),
      403,
    );
  } finally {
    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { modulesEnabled: true },
      }),
    );
  }
  await expectJson(await owner.get(`/api/module/${beta.id}`));
});
