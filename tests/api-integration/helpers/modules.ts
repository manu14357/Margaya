import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import { json } from "./cycles";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./fixtures";

export { day, json } from "./cycles";

export type ModuleCountsJson = {
  total: number;
  backlog: number;
  unstarted: number;
  started: number;
  completed: number;
  cancelled: number;
};

export type ModuleJson = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  leadId: string | null;
  lead: { id: string; name: string; image: string | null } | null;
  memberIds: string[];
  position: number;
  archivedAt: string | null;
  counts: ModuleCountsJson;
  pending: number;
  progress: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModuleTaskChangeJson = {
  moduleId: string;
  added: string[];
  removed: string[];
  unchanged: string[];
  ignored: string[];
};

export async function moduleContext(role = "member") {
  const member = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "mod",
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();

  let nextNumber = 1;
  const createTask = async (
    overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const status = overrides.status ?? "to-do";
    const column = Object.values(columns).find((c) => c.slug === status);
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: `Task ${nextNumber}`,
        number: nextNumber++,
        status,
        columnId: column?.id ?? null,
        ...overrides,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    // A userId override seeds a consistent single assignee.
    if (task.userId) await assignTask(task.id, [task.userId]);
    return task;
  };

  /** Inserts a module directly, for fixtures the API would refuse to build. */
  const insertModule = async (
    overrides: Partial<typeof schema.moduleTable.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.moduleTable)
      .values({
        projectId: project.id,
        name: `Fixture module ${Math.random().toString(36).slice(2)}`,
        createdBy: member.user.id,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("Failed to create module");
    return row;
  };

  const link = async (moduleId: string, taskIds: string[]) => {
    await db
      .insert(schema.moduleTaskTable)
      .values(taskIds.map((taskId) => ({ moduleId, taskId })));
  };

  const request = (path: string, init?: RequestInit) =>
    app.request(`/api/module${path}`, init);

  /** A request that must answer 200; returns the parsed body. */
  const ok = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await request(path, init);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as T;
  };

  const createModule = (body: Record<string, unknown>) =>
    ok<ModuleJson>(`/project/${project.id}`, json("POST", body));

  const list = (query = "") =>
    ok<ModuleJson[]>(`/project/${project.id}${query}`);

  const linkedTaskIds = async (moduleId: string) => {
    const rows = await db
      .select({ taskId: schema.moduleTaskTable.taskId })
      .from(schema.moduleTaskTable)
      .where(eq(schema.moduleTaskTable.moduleId, moduleId));
    return rows.map((row) => row.taskId).sort();
  };

  return {
    ...member,
    project,
    columns,
    app,
    createTask,
    insertModule,
    link,
    request,
    ok,
    createModule,
    list,
    linkedTaskIds,
  };
}
