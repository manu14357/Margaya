import { and, asc, eq, sql } from "drizzle-orm";
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

export { json } from "./cycles";

export const ESTIMATES_OFF =
  "The Estimates feature is turned off for this project.";

export type EstimatePointJson = {
  id: string;
  estimateId: string;
  value: string;
  numericValue: number | null;
  position: number;
  taskCount: number;
};

export type EstimateJson = {
  id: string;
  projectId: string;
  name: string;
  type: "points" | "categories" | "time";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  points: EstimatePointJson[];
};

export type EstimateListJson = {
  activeEstimateId: string | null;
  estimates: EstimateJson[];
};

export const FIBONACCI = ["1", "2", "3", "5", "8", "13"];

/** Turns a project's estimates feature on or off directly in the database. */
export async function setEstimatesEnabled(projectId: string, enabled: boolean) {
  await db
    .update(schema.projectTable)
    .set({ estimatesEnabled: enabled })
    .where(eq(schema.projectTable.id, projectId));
}

/** An owner (by default) with a project whose estimates feature is on. */
export async function estimateContext(
  role = "owner",
  { enabled = true }: { enabled?: boolean } = {},
) {
  const member = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "est",
  });
  if (enabled) await setEstimatesEnabled(project.id, true);
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

  const request = (path: string, init?: RequestInit) =>
    app.request(`/api/estimate${path}`, init);

  /** A request that must answer 200; returns the parsed body. */
  const ok = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await request(path, init);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as T;
  };

  const createSystem = (
    body: { name: string; type: string; values: string[] },
    projectId = project.id,
  ) => ok<EstimateJson>(`/${projectId}`, json("POST", body));

  const list = (projectId = project.id) =>
    ok<EstimateListJson>(`/${projectId}`);

  const setTaskEstimate = (taskId: string, estimatePointId: string | null) =>
    app.request(
      `/api/task/estimate/${taskId}`,
      json("PUT", { estimatePointId }),
    );

  /** Sets a task's estimate straight in the database, for fixtures. */
  const assignPoint = async (taskIds: string[], pointId: string | null) => {
    for (const taskId of taskIds) {
      await db
        .update(schema.taskTable)
        .set({ estimatePointId: pointId })
        .where(eq(schema.taskTable.id, taskId));
    }
  };

  const pointOf = async (taskId: string) => {
    const [task] = await db
      .select({ estimatePointId: schema.taskTable.estimatePointId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, taskId));
    return task?.estimatePointId ?? null;
  };

  return {
    ...member,
    project,
    columns,
    app,
    createTask,
    request,
    ok,
    createSystem,
    list,
    setTaskEstimate,
    assignPoint,
    pointOf,
  };
}

/** The `estimate_changed` history of a task, oldest first. */
export async function estimateActivities(taskId: string) {
  return db
    .select({
      type: schema.activityTable.type,
      userId: schema.activityTable.userId,
      content: schema.activityTable.content,
      eventData: schema.activityTable.eventData,
    })
    .from(schema.activityTable)
    .where(
      and(
        eq(schema.activityTable.taskId, taskId),
        eq(schema.activityTable.type, "estimate_changed"),
      ),
    )
    .orderBy(asc(schema.activityTable.createdAt));
}

/** Counts rows of the estimate tables, to prove a request wrote nothing. */
export async function estimateRowCounts() {
  const [estimates] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.estimateTable);
  const [points] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.estimatePointTable);
  return { estimates: estimates?.count ?? 0, points: points?.count ?? 0 };
}

/**
 * The D2 invariant: every task's estimate is a point of its own project's
 * active system.
 */
export async function expectEstimateInvariant() {
  const result = await db.execute<{ id: string }>(sql`
    select t.id from task t
    join estimate_point ep on ep.id = t.estimate_point_id
    join estimate e on e.id = ep.estimate_id
    where not (e.is_active and e.project_id = t.project_id)
  `);
  expect(result.rows).toEqual([]);
}
