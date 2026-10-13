import type { APIRequestContext } from "@playwright/test";
import pg from "pg";
import { loadSeedManifest } from "./auth";
import { E2E_DATABASE_URL } from "./env";
import { readJson } from "./http";

// API-side data builders for the task, board, planning and estimate UI specs.
// Every spec creates its own project so it can mutate freely while other spec
// files run in parallel against the same database.

export type ProjectColumn = {
  id: string;
  name: string;
  slug: string;
  group: string;
  isFinal?: boolean;
};

export type TestProject = {
  id: string;
  name: string;
  slug: string;
  columns: ProjectColumn[];
};

export type TestTask = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  dueDate: string | null;
  startDate: string | null;
  cycleId?: string | null;
  estimatePointId?: string | null;
  archivedAt?: string | null;
  assigneeIds?: string[];
};

export type ProjectFeatures = {
  cyclesEnabled?: boolean;
  modulesEnabled?: boolean;
  estimatesEnabled?: boolean;
  timeTrackingEnabled?: boolean;
};

type Priority = "no-priority" | "low" | "medium" | "high" | "urgent";

/** A short random project key (task ids read KEY-1), unique per run. */
export function uniqueProjectKey(prefix = "T"): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let key = prefix;
  for (let i = 0; i < 5; i += 1) {
    key += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return key;
}

/** A calendar day (YYYY-MM-DD) `offsetDays` from today, in local time. */
export function dayOffset(offsetDays: number, from = new Date()): string {
  const day = new Date(from);
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + offsetDays);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** An ISO timestamp at local noon, `offsetDays` from today (task due/start dates). */
export function isoDayOffset(offsetDays: number): string {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + offsetDays);
  return day.toISOString();
}

export async function createProject(
  api: APIRequestContext,
  options: {
    name: string;
    slug?: string;
    features?: ProjectFeatures;
  },
): Promise<TestProject> {
  const { workspace } = loadSeedManifest();
  const slug = options.slug ?? uniqueProjectKey();
  const project = await readJson<{ id: string; name: string; slug: string }>(
    await api.post("/api/project", {
      data: {
        name: options.name,
        workspaceId: workspace.id,
        icon: "Layout",
        slug,
      },
    }),
    `create project ${options.name}`,
  );
  if (options.features && Object.keys(options.features).length > 0) {
    await setProjectFeatures(api, project.id, options.features);
  }
  const columns = await listColumns(api, project.id);
  return { id: project.id, name: project.name, slug: project.slug, columns };
}

export async function setProjectFeatures(
  api: APIRequestContext,
  projectId: string,
  features: ProjectFeatures,
): Promise<void> {
  await readJson(
    await api.patch(`/api/project/${projectId}/features`, { data: features }),
    "update project features",
  );
}

export async function listColumns(
  api: APIRequestContext,
  projectId: string,
): Promise<ProjectColumn[]> {
  return readJson<ProjectColumn[]>(
    await api.get(`/api/column/${projectId}`),
    "list columns",
  );
}

export async function createTask(
  api: APIRequestContext,
  projectId: string,
  task: {
    title: string;
    description?: string;
    status?: string;
    priority?: Priority;
    assigneeIds?: string[];
    dueDate?: string;
    startDate?: string;
    estimatePointId?: string | null;
  },
): Promise<TestTask> {
  return readJson<TestTask>(
    await api.post(`/api/task/${projectId}`, {
      data: {
        description: "",
        status: "to-do",
        priority: "no-priority",
        ...task,
      },
    }),
    `create task ${task.title}`,
  );
}

export async function getTask(
  api: APIRequestContext,
  taskId: string,
): Promise<TestTask & Record<string, unknown>> {
  return readJson(await api.get(`/api/task/${taskId}`), "get task");
}

type BoardResponse = {
  data: {
    columns: { id: string; name: string; tasks: TestTask[] }[];
    archivedTasks: TestTask[];
    plannedTasks: TestTask[];
  };
  pagination: { totalPages: number };
};

/** Every task of a project, keyed by title, with its column and position order. */
export async function listBoard(
  api: APIRequestContext,
  projectId: string,
): Promise<BoardResponse["data"]> {
  const board = await readJson<BoardResponse>(
    await api.get(`/api/task/tasks/${projectId}`, {
      params: { limit: 100, sortBy: "position", sortOrder: "asc" },
    }),
    "list board",
  );
  return board.data;
}

export async function addLabelToTask(
  api: APIRequestContext,
  labelId: string,
  taskId: string,
): Promise<void> {
  await readJson(
    await api.put(`/api/label/${labelId}/task`, { data: { taskId } }),
    "add label to task",
  );
}

export async function taskLabelNames(
  api: APIRequestContext,
  taskId: string,
): Promise<string[]> {
  const labels = await readJson<{ name: string }[]>(
    await api.get(`/api/label/task/${taskId}`),
    "list task labels",
  );
  return labels.map((label) => label.name);
}

export async function taskAssigneeIds(
  api: APIRequestContext,
  taskId: string,
): Promise<string[]> {
  const task = await getTask(api, taskId);
  return (task.assigneeIds as string[] | undefined) ?? [];
}

export async function createCycle(
  api: APIRequestContext,
  projectId: string,
  cycle: {
    name: string;
    startDate: string | null;
    endDate: string | null;
    description?: string;
  },
): Promise<{ id: string; name: string }> {
  return readJson(
    await api.post(`/api/cycle/project/${projectId}`, { data: cycle }),
    `create cycle ${cycle.name}`,
  );
}

/**
 * Moves a cycle's dates into the past so it reads as completed. Cycles only
 * take tasks while they are not completed and time can't be advanced through
 * the API, so this one setup step writes the e2e database directly.
 */
export async function backdateCycle(
  cycleId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      "UPDATE cycle SET start_date = $2, end_date = $3 WHERE id = $1",
      [cycleId, startDate, endDate],
    );
    if (result.rowCount !== 1) throw new Error(`cycle ${cycleId} not found`);
  } finally {
    await client.end();
  }
}

export async function addTasksToCycle(
  api: APIRequestContext,
  cycleId: string,
  taskIds: string[],
): Promise<void> {
  await readJson(
    await api.post(`/api/cycle/${cycleId}/tasks`, { data: { taskIds } }),
    "add tasks to cycle",
  );
}

export async function createModule(
  api: APIRequestContext,
  projectId: string,
  mod: {
    name: string;
    status?: string;
    leadId?: string | null;
    memberIds?: string[];
    startDate?: string | null;
    targetDate?: string | null;
    description?: string | null;
  },
): Promise<{ id: string; name: string }> {
  return readJson(
    await api.post(`/api/module/project/${projectId}`, { data: mod }),
    `create module ${mod.name}`,
  );
}

export async function addTasksToModule(
  api: APIRequestContext,
  moduleId: string,
  taskIds: string[],
): Promise<void> {
  await readJson(
    await api.post(`/api/module/${moduleId}/tasks`, { data: { taskIds } }),
    "add tasks to module",
  );
}

export async function taskModuleNames(
  api: APIRequestContext,
  taskId: string,
): Promise<string[]> {
  const body = await readJson<unknown>(
    await api.get(`/api/module/task/${taskId}`),
    "list task modules",
  );
  const list = Array.isArray(body)
    ? body
    : ((body as { modules?: unknown[] }).modules ?? []);
  return (list as { name: string }[]).map((m) => m.name);
}

export type TestEstimate = {
  id: string;
  name: string;
  isActive: boolean;
  points: { id: string; value: string }[];
};

export async function createEstimate(
  api: APIRequestContext,
  projectId: string,
  estimate: {
    name: string;
    type: "points" | "categories" | "time";
    values: string[];
  },
  { activate = true } = {},
): Promise<TestEstimate> {
  const created = await readJson<TestEstimate>(
    await api.post(`/api/estimate/${projectId}`, { data: estimate }),
    `create estimate ${estimate.name}`,
  );
  if (activate) {
    await readJson(
      await api.post(`/api/estimate/${projectId}/${created.id}/activate`, {
        data: { mapping: [] },
      }),
      "activate estimate",
    );
  }
  return created;
}

export async function setTaskEstimate(
  api: APIRequestContext,
  taskId: string,
  estimatePointId: string | null,
): Promise<void> {
  await readJson(
    await api.put(`/api/task/estimate/${taskId}`, {
      data: { estimatePointId },
    }),
    "set task estimate",
  );
}

export type TestView = {
  id: string;
  name: string;
  access: "workspace" | "private";
  projectId: string | null;
  isLocked?: boolean;
};

/** A saved view; `conditions` become the root "and" group of its filters. */
export async function createView(
  api: APIRequestContext,
  view: {
    name: string;
    projectId?: string;
    access?: "workspace" | "private";
    description?: string;
    conditions?: { key: string; operator: string; values?: string[] }[];
    layout?: "list" | "board" | "spreadsheet";
  },
): Promise<TestView> {
  const { workspace } = loadSeedManifest();
  return readJson<TestView>(
    await api.post("/api/view", {
      data: {
        workspaceId: workspace.id,
        ...(view.projectId ? { projectId: view.projectId } : {}),
        name: view.name,
        ...(view.description ? { description: view.description } : {}),
        access: view.access ?? "workspace",
        ...(view.conditions
          ? { filters: { root: { op: "and", children: view.conditions } } }
          : {}),
        ...(view.layout ? { display: { layout: view.layout } } : {}),
      },
    }),
    `create view ${view.name}`,
  );
}

export async function listViews(
  api: APIRequestContext,
  projectId?: string,
): Promise<TestView[]> {
  const { workspace } = loadSeedManifest();
  const body = await readJson<unknown>(
    await api.get("/api/view", {
      params: {
        workspaceId: workspace.id,
        ...(projectId ? { projectId } : {}),
      },
    }),
    "list views",
  );
  return (
    Array.isArray(body) ? body : ((body as { views?: unknown[] }).views ?? [])
  ) as TestView[];
}

/** Deletes a view; failures are ignored so cleanup never fails a test. */
export async function deleteView(
  api: APIRequestContext,
  viewId: string,
): Promise<void> {
  await api.post(`/api/view/${viewId}/unlock`).catch(() => undefined);
  await api.delete(`/api/view/${viewId}`).catch(() => undefined);
}

/** Deletes the project; failures are ignored so cleanup never fails a test. */
export async function deleteProject(
  api: APIRequestContext,
  projectId: string,
): Promise<void> {
  await api.delete(`/api/project/${projectId}`).catch(() => undefined);
}

export function boardPath(projectId: string): string {
  const { workspace } = loadSeedManifest();
  return `/dashboard/workspace/${workspace.id}/project/${projectId}/board`;
}

export function projectViewPath(
  projectId: string,
  view: "board" | "backlog" | "calendar" | "gantt" | "cycles" | "modules",
): string {
  const { workspace } = loadSeedManifest();
  return `/dashboard/workspace/${workspace.id}/project/${projectId}/${view}`;
}

export function taskPagePath(projectId: string, taskId: string): string {
  const { workspace } = loadSeedManifest();
  return `/dashboard/workspace/${workspace.id}/project/${projectId}/task/${taskId}`;
}

export function projectSettingsPath(
  projectId: string,
  page: "estimates" | "features" | "general" | "workflow",
): string {
  return `/dashboard/settings/projects/${projectId}/${page}`;
}
