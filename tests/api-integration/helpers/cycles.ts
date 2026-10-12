import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { shiftDate, todayUtc } from "../../../apps/api/src/utils/calendar-date";
import { mockAuthenticatedSession } from "./auth";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./fixtures";

export type CycleJson = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  ownerId: string | null;
  owner: { id: string; name: string; image: string | null } | null;
  sortOrder: number;
  status: "draft" | "upcoming" | "current" | "completed";
  today: string;
  archivedAt: string | null;
  isFrozen: boolean;
  counts: {
    total: number;
    backlog: number;
    unstarted: number;
    started: number;
    completed: number;
    cancelled: number;
  };
  pending: number;
  progress: number;
};

export type CycleTaskChangeJson = {
  cycleId: string;
  added: string[];
  moved: Array<{ taskId: string; fromCycleId: string }>;
  removed: string[];
  unchanged: string[];
  ignored: string[];
};

/** A calendar date relative to the real UTC today. */
export function day(offset: number): string {
  return shiftDate(todayUtc(), offset);
}

export function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function cycleContext(role = "member") {
  const member = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "cyc",
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

  /** Inserts a cycle directly, for fixtures the API would refuse to build. */
  const insertCycle = async (
    overrides: Partial<typeof schema.cycleTable.$inferInsert> = {},
  ) => {
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: project.id,
        name: "Fixture cycle",
        ownerId: member.user.id,
        createdBy: member.user.id,
        ...overrides,
      })
      .returning();
    if (!cycle) throw new Error("Failed to create cycle");
    return cycle;
  };

  const addToCycle = async (cycleId: string, taskIds: string[]) => {
    await db
      .insert(schema.cycleTaskTable)
      .values(taskIds.map((taskId) => ({ taskId, cycleId })));
  };

  const createCycle = async (body: Record<string, unknown>) => {
    const response = await app.request(
      `/api/cycle/project/${project.id}`,
      json("POST", body),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as CycleJson;
  };

  const list = async (query = "") => {
    const response = await app.request(
      `/api/cycle/project/${project.id}${query}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as CycleJson[];
  };

  const membership = async (taskId: string) => {
    const [row] = await db
      .select()
      .from(schema.cycleTaskTable)
      .where(eq(schema.cycleTaskTable.taskId, taskId));
    return row?.cycleId ?? null;
  };

  return {
    ...member,
    project,
    columns,
    app,
    createTask,
    insertCycle,
    addToCycle,
    createCycle,
    list,
    membership,
  };
}
