import { and, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { mockAuthenticatedSession } from "./auth";
import { json } from "./cycles";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./fixtures";

export { json } from "./cycles";

type User = typeof schema.userTable.$inferSelect;
type TaskInsert = typeof schema.taskTable.$inferInsert;

/** Only Date is faked, so the database driver's timers keep running. */
export function freeze(instant = "2026-03-25T12:00:00.000Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
}

export const at = (instant: string) => new Date(instant);

export type Bucket = {
  key: string;
  value: number;
  taskCount: number;
  cells?: Record<string, number>;
  progress: number | null;
  rangeStart?: string;
  rangeEnd?: string;
};

export type ChartJson = {
  xAxis: string;
  segment: string | null;
  metric: string;
  dateBucket: string | null;
  today: string;
  totalCount: number;
  totalValue: number;
  progress: number | null;
  noneCount: number | null;
  buckets: Bucket[];
  segments: { key: string; value: number; taskCount: number }[];
  truncated: {
    x: boolean;
    hiddenXCount: number;
    segment: boolean;
    hiddenSegmentCount: number;
  };
  multiValued: { x: boolean; segment: boolean };
  pointsProjectIds: string[];
  meta: {
    users: { id: string; name: string; image: string | null }[];
    projects: { id: string; name: string; slug: string }[];
    columns: { slug: string; name: string; group: string; position: number }[];
    labels: { key: string; name: string; color: string }[];
    cycles: { id: string; name: string; status: string }[];
    modules: { id: string; name: string; status: string }[];
    estimates: { key: string; type: string; value: string }[];
  };
};

/** Bucket key → value. */
export function values(chart: { buckets: Bucket[] }): Record<string, number> {
  return Object.fromEntries(chart.buckets.map((b) => [b.key, b.value]));
}

export function keys(chart: { buckets: Bucket[] }): string[] {
  return chart.buckets.map((bucket) => bucket.key);
}

export function bucket(chart: { buckets: Bucket[] }, key: string): Bucket {
  const found = chart.buckets.find((entry) => entry.key === key);
  if (!found) throw new Error(`No bucket ${key}`);
  return found;
}

/**
 * The B8 §6.1 workspace: owner Olivia, admin Ada, members Ben (M1) and Cara
 * (M2), viewer Vic. Project "web" (P1) has To Do, In Progress, In Review,
 * Done, Won't do and a triage column, with estimates on and an active points
 * system; project "api" (P2) has the default columns and estimates off.
 * Workspace labels Bug and Feature.
 */
export async function analyticsScene() {
  const ownerContext = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia",
  });
  const owner = ownerContext.user;
  const workspaceId = ownerContext.workspace.id;
  const admin = await addPerson(workspaceId, "Ada", "admin");
  const m1 = await addPerson(workspaceId, "Ben", "member");
  const m2 = await addPerson(workspaceId, "Cara", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");

  const { project: p1 } = await createProjectFixture({
    workspaceId,
    slug: "web",
    name: "Web",
  });
  const { project: p2 } = await createProjectFixture({
    workspaceId,
    slug: "api",
    name: "API",
  });
  await db
    .update(schema.projectTable)
    .set({ position: 1 })
    .where(eq(schema.projectTable.id, p2.id));
  await db
    .update(schema.projectTable)
    .set({ estimatesEnabled: true })
    .where(eq(schema.projectTable.id, p1.id));
  await db.insert(schema.columnTable).values([
    {
      projectId: p1.id,
      name: "Won't do",
      slug: "wont-do",
      position: 4,
      group: "cancelled",
      isFinal: false,
    },
    {
      projectId: p1.id,
      name: "Triage",
      slug: "triage",
      position: 5,
      group: "triage",
      isFinal: false,
    },
  ]);

  const [estimate] = await db
    .insert(schema.estimateTable)
    .values({
      projectId: p1.id,
      name: "Points",
      type: "points",
      isActive: true,
    })
    .returning();
  if (!estimate) throw new Error("Failed to create estimate");
  const points = new Map<number, string>();
  for (const [position, value] of [1, 2, 3, 5, 8].entries()) {
    const [point] = await db
      .insert(schema.estimatePointTable)
      .values({
        estimateId: estimate.id,
        value: String(value),
        numericValue: value,
        position,
      })
      .returning();
    if (point) points.set(value, point.id);
  }

  const workspaceLabel = async (name: string, color: string) => {
    await db.insert(schema.labelTable).values({ name, color, workspaceId });
  };
  await workspaceLabel("Bug", "#dc2626");
  await workspaceLabel("Feature", "#2563eb");

  const numbers = new Map<string, number>();

  /** Inserts a task straight into the database (exact fixtures). */
  const createTask = async (
    overrides: Partial<TaskInsert> & {
      assignees?: string[];
      labels?: string[];
      points?: number;
    } = {},
  ) => {
    const { assignees, labels, points: value, ...values } = overrides;
    const projectId = values.projectId ?? p1.id;
    const number = (numbers.get(projectId) ?? 0) + 1;
    numbers.set(projectId, number);
    const status = values.status ?? "to-do";
    const [column] = await db
      .select({ id: schema.columnTable.id })
      .from(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, projectId),
          eq(schema.columnTable.slug, status),
        ),
      )
      .limit(1);
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: `Task ${number}`,
        number,
        position: number,
        status,
        columnId: column?.id ?? null,
        priority: "no-priority",
        createdBy: owner.id,
        estimatePointId: value === undefined ? null : points.get(value),
        ...values,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    if (assignees) await assignTask(task.id, assignees);
    for (const name of labels ?? []) {
      await db
        .insert(schema.labelTable)
        .values({ name, color: "#999999", taskId: task.id, workspaceId });
    }
    return task;
  };

  const { app } = createApp();

  const post = (path: string, body: Record<string, unknown>, user: User) => {
    mockAuthenticatedSession(user);
    return app.request(
      `/api/analytics${path}`,
      json("POST", { workspaceId, ...body }),
    );
  };

  const get = (path: string, query: Record<string, string>, user: User) => {
    mockAuthenticatedSession(user);
    const search = new URLSearchParams({ workspaceId, ...query });
    return app.request(`/api/analytics${path}?${search}`);
  };

  async function ok<T>(response: Promise<Response>): Promise<T> {
    const result = await response;
    expect(result.status, await result.clone().text()).toBe(200);
    return (await result.json()) as T;
  }

  /** The response must fail with this status (and message, when given). */
  async function fails(
    response: Promise<Response>,
    status: number,
    message?: string,
  ) {
    const result = await response;
    const text = await result.text();
    expect(result.status, text).toBe(status);
    if (message !== undefined) expect(text).toBe(message);
  }

  const chart = (body: Record<string, unknown>, user: User = owner) =>
    ok<ChartJson>(post("/chart", body, user));

  return {
    app,
    workspaceId,
    workspace: ownerContext.workspace,
    owner,
    admin,
    m1,
    m2,
    viewer,
    p1,
    p2,
    estimate,
    points,
    createTask,
    post,
    get,
    ok,
    fails,
    chart,
  };
}

export type AnalyticsScene = Awaited<ReturnType<typeof analyticsScene>>;

/** The §6.1 tasks. */
export async function seedCanonical(s: AnalyticsScene) {
  const { m1, m2, p2 } = s;
  const t1 = await s.createTask({
    status: "planned",
    priority: "high",
    assignees: [m1.id],
    labels: ["Bug"],
    createdAt: at("2026-03-02T09:00:00Z"),
  });
  const t2 = await s.createTask({
    status: "to-do",
    priority: "urgent",
    assignees: [m1.id, m2.id],
    labels: ["Bug", "Feature"],
    points: 3,
    createdAt: at("2026-03-03T09:00:00Z"),
  });
  const t3 = await s.createTask({
    status: "in-progress",
    priority: "medium",
    assignees: [m2.id],
    points: 5,
    createdAt: at("2026-03-09T09:00:00Z"),
  });
  const t4 = await s.createTask({
    status: "done",
    priority: "low",
    assignees: [m1.id],
    labels: ["Feature"],
    points: 2,
    createdAt: at("2026-03-04T09:00:00Z"),
    completedAt: at("2026-03-10T10:00:00Z"),
  });
  const t5 = await s.createTask({
    status: "done",
    priority: "no-priority",
    createdAt: at("2026-03-05T09:00:00Z"),
    completedAt: at("2026-03-20T10:00:00Z"),
  });
  const t6 = await s.createTask({
    status: "wont-do",
    priority: "high",
    assignees: [m2.id],
    points: 8,
    createdAt: at("2026-03-06T09:00:00Z"),
  });
  const t7 = await s.createTask({
    status: "done",
    priority: "low",
    assignees: [m1.id],
    createdAt: at("2026-02-10T09:00:00Z"),
    completedAt: at("2026-02-12T10:00:00Z"),
    archivedAt: at("2026-03-01T09:00:00Z"),
  });
  const t8 = await s.createTask({
    status: "triage",
    priority: "no-priority",
    createdAt: at("2026-03-07T09:00:00Z"),
  });
  const u1 = await s.createTask({
    projectId: p2.id,
    status: "to-do",
    priority: "high",
    assignees: [m1.id],
    createdAt: at("2026-03-16T09:00:00Z"),
    dueDate: at("2026-03-20T00:00:00Z"),
  });
  const u2 = await s.createTask({
    projectId: p2.id,
    status: "done",
    priority: "high",
    createdAt: at("2026-03-17T09:00:00Z"),
    completedAt: at("2026-03-24T10:00:00Z"),
  });
  return { t1, t2, t3, t4, t5, t6, t7, t8, u1, u2 };
}
