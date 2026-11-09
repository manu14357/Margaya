import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  eventually,
  expectJson,
  expectStatus,
  type Json,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Workspace-level features: task drafts, exports, archives, analytics, the
// "my activity" feed and per-project automations.

type Draft = Json & { title: string; projectId: string | null };
type Export = Json & { status?: string; format?: string };
type WorkspaceExport = Json & { status: string; projectIds: string[] };
type Workload = {
  unit: string;
  members: { userId: string | null }[];
  meta: { users: { id: string }[] };
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Features");
  project = await createProject(world.as("owner"), world.workspace.id);
  await createTask(world.as("owner"), project.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "task drafts: create, count, list, read, edit, publish and delete",
  covers(
    "createTaskDraft",
    "countTaskDrafts",
    "listTaskDrafts",
    "getTaskDraft",
    "updateTaskDraft",
    "publishTaskDraft",
    "deleteTaskDraft",
  ),
  async () => {
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const draft = await expectJson<Draft>(
      await member.post("/api/task-draft", {
        data: {
          workspaceId,
          projectId: project.id,
          title: uniqueName("Draft"),
        },
      }),
    );
    const spare = await expectJson<Draft>(
      await member.post("/api/task-draft", {
        data: { workspaceId, title: uniqueName("Spare draft") },
      }),
    );

    const count = await expectJson<{ count: number }>(
      await member.get("/api/task-draft/count", { params: { workspaceId } }),
    );
    expect(count.count).toBe(2);
    const list = await expectJson<{ drafts: Draft[]; total: number }>(
      await member.get("/api/task-draft", { params: { workspaceId } }),
    );
    expect(list.drafts.map((entry) => entry.id).sort()).toEqual(
      [draft.id, spare.id].sort(),
    );
    // Drafts are private to their author.
    const ownerList = await expectJson<{ drafts: Draft[] }>(
      await world
        .as("owner")
        .get("/api/task-draft", { params: { workspaceId } }),
    );
    expect(ownerList.drafts).toEqual([]);
    await expectStatus(
      await world.as("owner").get(`/api/task-draft/${draft.id}`),
      [403, 404],
    );

    const read = await expectJson<Draft>(
      await member.get(`/api/task-draft/${draft.id}`),
    );
    expect(read.title).toBe(draft.title);
    const edited = await expectJson<Draft>(
      await member.patch(`/api/task-draft/${draft.id}`, {
        data: { title: "Edited draft", priority: "high" },
      }),
    );
    expect(edited.title).toBe("Edited draft");

    const published = await expectJson<{
      task: { id: string; title: string; projectId: string };
      key: string;
    }>(await member.post(`/api/task-draft/${draft.id}/publish`, { data: {} }));
    expect(published.task).toMatchObject({
      title: "Edited draft",
      projectId: project.id,
    });
    expect(published.key).toMatch(new RegExp(`^${project.slug}-\\d+$`));
    await expectStatus(await member.get(`/api/task-draft/${draft.id}`), 404);

    await expectJson(await member.delete(`/api/task-draft/${spare.id}`));
    const after = await expectJson<{ count: number }>(
      await member.get("/api/task-draft/count", { params: { workspaceId } }),
    );
    expect(after.count).toBe(0);
  },
);

test(
  "task exports: create, list, read, download and delete",
  covers(
    "createTaskExport",
    "listTaskExports",
    "getTaskExport",
    "downloadTaskExport",
    "deleteTaskExport",
  ),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const created = await expectJson<Export & { export?: Export }>(
      await owner.post("/api/task-export", {
        data: { workspaceId, format: "csv", projectIds: [project.id] },
      }),
    );
    const id = created.export?.id ?? created.id;
    expect(id).toBeTruthy();

    const listed = await expectJson<{ items: Export[] }>(
      await owner.get("/api/task-export", { params: { workspaceId } }),
    );
    expect(listed.items.map((item) => item.id)).toContain(id);

    // Exports run in the background; wait until the file is ready.
    await eventually(
      async () => {
        const one = await expectJson<Export & { export?: Export }>(
          await owner.get(`/api/task-export/${id}`),
        );
        const status = one.export?.status ?? one.status;
        if (status === "failed") throw new Error("export failed");
        return status === "completed" || status === "ready";
      },
      { timeoutMs: 60_000, what: "export ready" },
    );
    const download = await owner.get(`/api/task-export/${id}/download`, {
      maxRedirects: 0,
    });
    expect([200, 302]).toContain(download.status());

    await expectJson(await owner.delete(`/api/task-export/${id}`));
    await expectStatus(await owner.get(`/api/task-export/${id}`), 404);
  },
);

test(
  "a whole-workspace export is for those who can read all of it",
  covers("createWorkspaceExport"),
  async () => {
    // It runs in the background, next to whatever else the suite is doing.
    test.setTimeout(180_000);
    const owner = world.as("owner");
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const start = "/api/task-export/workspace";

    await expectStatus(
      await member.post(start, { data: { workspaceId } }),
      403,
    );
    await expectStatus(
      await world.as("viewer").post(start, { data: { workspaceId } }),
      403,
    );
    await expectStatus(
      await world.anonymous.post(start, { data: { workspaceId } }),
      401,
    );
    await expectStatus(
      await owner.post(start, { data: { workspaceId, includeFiles: "yes" } }),
      400,
    );

    const created = await expectJson<WorkspaceExport>(
      await owner.post(start, { data: { workspaceId, includeFiles: false } }),
    );
    expect(created).toMatchObject({
      kind: "workspace",
      format: "json",
      includeFiles: false,
      includeArchived: true,
    });
    expect(created.projectIds).toContain(project.id);
    const url = `/api/task-export/${created.id}`;

    const listed = await expectJson<{ items: Export[] }>(
      await owner.get("/api/task-export", { params: { workspaceId } }),
    );
    expect(listed.items.map((item) => item.id)).toContain(created.id);

    // Anyone who may not start one can't tell it exists.
    await expectStatus(await member.get(url), 404);

    const finished = await eventually(
      async () => {
        const one = await expectJson<WorkspaceExport>(await owner.get(url));
        return one.status === "queued" || one.status === "processing"
          ? null
          : one;
      },
      {
        timeoutMs: 150_000,
        intervalMs: 1_000,
        what: "whole-workspace export finished",
      },
    );
    expect(finished).toMatchObject({ status: "completed", downloadable: true });

    const download = await owner.get(`${url}/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("zip");
    expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
    await expectStatus(await member.get(`${url}/download`), 404);
    await expectStatus(await member.delete(url), 404);

    await expectJson(await owner.delete(url));
    await expectStatus(await owner.get(url), 404);
  },
);

test(
  "archives: a summary per type and archived lists",
  covers("getArchiveSummary", "listArchived"),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const archived = await createProject(owner, workspaceId, {
      name: uniqueName("Archived project"),
    });
    await expectJson(await owner.put(`/api/project/${archived.id}/archive`));

    const summary = await expectJson<{ projects: number | null }>(
      await owner.get("/api/archive/summary", { params: { workspaceId } }),
    );
    expect(summary.projects).toBeGreaterThanOrEqual(1);

    const projects = await expectJson<{ items: Json[]; total: number }>(
      await owner.get("/api/archive/project", { params: { workspaceId } }),
    );
    expect(projects.items.map((item) => item.id)).toContain(archived.id);
    for (const type of ["cycle", "module"]) {
      const list = await expectJson<{ items: Json[] }>(
        await owner.get(`/api/archive/${type}`, { params: { workspaceId } }),
      );
      expect(list.items).toEqual([]);
    }
    await expectStatus(
      await owner.get("/api/archive/sticky", { params: { workspaceId } }),
      400,
    );
  },
);

test(
  "analytics: overview, charts, trends, cycles, modules and intake",
  covers(
    "getAnalyticsOverview",
    "queryAnalyticsChart",
    "queryAnalyticsTrend",
    "getAnalyticsCycles",
    "getAnalyticsModules",
    "getAnalyticsIntake",
  ),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const overview = await expectJson<{
      tasks: { total: number };
      projects: { total: number };
    }>(await owner.get("/api/analytics/overview", { params: { workspaceId } }));
    expect(overview.tasks.total).toBeGreaterThanOrEqual(1);
    expect(overview.projects.total).toBeGreaterThanOrEqual(1);

    await expectJson(
      await owner.post("/api/analytics/chart", {
        data: { workspaceId, xAxis: "priority" },
      }),
    );
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 24 * 3600 * 1000);
    await expectJson(
      await owner.post("/api/analytics/trend", {
        data: {
          workspaceId,
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          bucket: "week",
        },
      }),
    );
    await expectJson(
      await owner.get("/api/analytics/cycles", { params: { workspaceId } }),
    );
    await expectJson(
      await owner.get("/api/analytics/modules", { params: { workspaceId } }),
    );
    await expectJson(
      await owner.get("/api/analytics/intake", {
        params: {
          workspaceId,
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          bucket: "week",
        },
      }),
    );
    // Outsiders see nothing.
    await expectStatus(
      await world.anonymous.get("/api/analytics/overview", {
        params: { workspaceId },
      }),
      401,
    );
  },
);

test(
  "analytics: open work per person",
  covers("getAnalyticsWorkload"),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const assigneeId = world.users.member.id;
    const scoped = await createProject(owner, workspaceId);
    const assigneeIds = [assigneeId];
    await createTask(owner, scoped.id, { assigneeIds });
    await createTask(owner, scoped.id, { assigneeIds, status: "in-progress" });
    await createTask(owner, scoped.id);
    const params = { workspaceId, projectIds: scoped.id };

    // Members hold cycle:update, so they also get each person's check.
    const workload = await expectJson<Workload>(
      await world.as("member").get("/api/analytics/workload", { params }),
    );
    expect(workload.unit).toBe("tasks");
    expect(workload.members).toHaveLength(2);
    expect(workload.members[0]).toMatchObject({
      userId: assigneeId,
      tasks: 2,
      load: 2,
      cells: { backlog: 0, unstarted: 1, started: 1 },
      // Nothing finished in this project yet: unknown, never over.
      check: { usual: null, status: "unknown" },
    });
    // Unassigned work comes last and has no one to check against.
    expect(workload.members[1]).toMatchObject({
      userId: null,
      tasks: 1,
      check: null,
    });
    expect(workload.meta.users.map((user) => user.id)).toContain(assigneeId);

    // Per-person numbers stay with members and up.
    await expectStatus(
      await world.as("viewer").get("/api/analytics/workload", { params }),
      403,
    );
    await expectStatus(
      await world.anonymous.get("/api/analytics/workload", { params }),
      401,
    );
    await expectStatus(
      await owner.get("/api/analytics/workload", {
        params: { ...params, timeZone: "Mars/Olympus_Mons" },
      }),
      400,
    );
    await expectStatus(
      await owner.get("/api/analytics/workload", {
        params: { workspaceId, projectIds: "e2e-unknown-project" },
      }),
      404,
    );
  },
);

test("my activity lists what I did", covers("getMyActivity"), async () => {
  const member = world.as("member");
  const task = await createTask(member, project.id, {
    title: uniqueName("Mine"),
  });
  const feed = await expectJson<{ items: Json[]; nextCursor: string | null }>(
    await member.get("/api/activity/mine", {
      params: { workspaceId: world.workspace.id },
    }),
  );
  expect(JSON.stringify(feed.items)).toContain(task.id);
  await expectStatus(
    await world.anonymous.get("/api/activity/mine", {
      params: { workspaceId: world.workspace.id },
    }),
    401,
  );
});

test(
  "project automations: read, preview and update auto-archive",
  covers(
    "getProjectAutomations",
    "previewProjectAutomation",
    "updateProjectAutomations",
  ),
  async () => {
    const owner = world.as("owner");
    const current = await expectJson<{
      projectId: string;
      autoArchive: { enabled: boolean; months: number };
    }>(await owner.get(`/api/project-automation/${project.id}`));
    expect(current.projectId).toBe(project.id);

    const preview = await expectJson<{ rule: string; count: number }>(
      await owner.get(`/api/project-automation/${project.id}/preview`, {
        params: { rule: "archive", months: "3" },
      }),
    );
    expect(preview).toMatchObject({ rule: "archive", count: 0 });

    const enabled = await expectJson<{
      autoArchive: { enabled: boolean; months: number };
    }>(
      await owner.patch(`/api/project-automation/${project.id}`, {
        data: { autoArchive: { enabled: true, months: 3 } },
      }),
    );
    expect(enabled.autoArchive).toMatchObject({ enabled: true, months: 3 });
    const disabled = await expectJson<{ autoArchive: { enabled: boolean } }>(
      await owner.patch(`/api/project-automation/${project.id}`, {
        data: { autoArchive: { enabled: false, months: 3 } },
      }),
    );
    expect(disabled.autoArchive.enabled).toBe(false);

    await expectStatus(
      await world.as("member").patch(`/api/project-automation/${project.id}`, {
        data: { autoArchive: { enabled: true, months: 3 } },
      }),
      403,
    );
  },
);
