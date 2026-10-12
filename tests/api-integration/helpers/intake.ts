import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { subscribeToEvent } from "../../../apps/api/src/events";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { mockAnonymousSession, mockAuthenticatedSession } from "./auth";
import { json } from "./cycles";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";

export { json } from "./cycles";

type User = typeof schema.userTable.$inferSelect;

export type IntakeItemJson = {
  id: string;
  projectId: string;
  taskId: string;
  status: string;
  snoozedUntil: string | null;
  source: string;
  resolutionNote: string | null;
  submittedBy: { id: string; name: string; image: string | null } | null;
  triagedBy: { id: string; name: string; image: string | null } | null;
  triagedAt: string | null;
  duplicateOf: {
    taskId: string;
    key: string;
    title: string;
    status: string;
  } | null;
  task: {
    id: string;
    projectId: string;
    number: number;
    key: string;
    title: string;
    priority: string;
    status: string;
    columnId: string | null;
    columnName: string | null;
    group: string;
    assigneeId: string | null;
    dueDate: string | null;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type IntakeListJson = {
  items: IntakeItemJson[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  counts: Record<
    "pending" | "snoozed" | "accepted" | "declined" | "duplicate",
    number
  >;
};

const published: Array<{ name: string; data: Record<string, unknown> }> = [];
const watched = new Set<string>();

/** Records every event of these names published from now on. */
export function recordEvents(...names: string[]) {
  for (const name of names) {
    if (watched.has(name)) continue;
    watched.add(name);
    subscribeToEvent<Record<string, unknown>>(name, async (data) => {
      published.push({ name, data });
    });
  }
}

export function publishedEvents(name?: string) {
  return published.filter((event) => !name || event.name === name);
}

export function clearPublishedEvents() {
  published.length = 0;
}

export async function setIntakeEnabled(projectId: string, enabled: boolean) {
  await db
    .update(schema.projectTable)
    .set({ intakeEnabled: enabled })
    .where(eq(schema.projectTable.id, projectId));
}

/**
 * A workspace with an admin (Ada), a member (Ben), a viewer (Vic) and an
 * outsider, and a project (slug "web") with intake turned on.
 */
export async function intakeScene() {
  const admin = await createWorkspaceMember({ role: "admin", userName: "Ada" });
  const workspaceId = admin.workspace.id;
  const member = await addPerson(workspaceId, "Ben", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");
  const outsider = await createWorkspaceMember({ userName: "Oz" });
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "web",
  });
  await setIntakeEnabled(project.id, true);
  const { app } = createApp();

  const as = (user: User) => (path: string, init?: RequestInit) => {
    mockAuthenticatedSession(user);
    return app.request(`/api${path}`, init);
  };

  async function submit(
    user: User,
    body: Record<string, unknown> = { title: "Please add dark mode" },
    projectId = project.id,
  ): Promise<IntakeItemJson> {
    const response = await as(user)(
      `/intake/project/${projectId}`,
      json("POST", body),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as IntakeItemJson;
  }

  async function list(user: User, query = "", projectId = project.id) {
    const response = await as(user)(
      `/intake/project/${projectId}${query ? `?${query}` : ""}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as IntakeListJson;
  }

  async function action(
    user: User,
    itemId: string,
    name: string,
    body?: Record<string, unknown>,
  ) {
    return as(user)(
      `/intake/item/${itemId}/${name}`,
      body === undefined ? { method: "POST" } : json("POST", body),
    );
  }

  let boardNumber = 1000;
  async function createBoardTask(
    overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) {
    boardNumber += 1;
    const status = overrides.status ?? "to-do";
    const projectId = overrides.projectId ?? project.id;
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
        title: `Board task ${boardNumber}`,
        number: boardNumber,
        status,
        columnId: column?.id ?? null,
        description: "",
        ...overrides,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    return task;
  }

  return {
    app,
    admin: admin.user,
    member,
    viewer,
    outsider: outsider.user,
    workspace: admin.workspace,
    project,
    columns,
    as,
    submit,
    list,
    action,
    createBoardTask,
  };
}

export async function intakeRow(itemId: string) {
  const [row] = await db
    .select()
    .from(schema.intakeItemTable)
    .where(eq(schema.intakeItemTable.id, itemId));
  return row ?? null;
}

export async function taskRow(taskId: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return row ?? null;
}

export async function activityTypes(taskId: string) {
  const rows = await db
    .select({
      type: schema.activityTable.type,
      userId: schema.activityTable.userId,
      eventData: schema.activityTable.eventData,
    })
    .from(schema.activityTable)
    .where(eq(schema.activityTable.taskId, taskId));
  return rows;
}

/** Waits until the task has `count` activity rows of `type`. */
export async function settledActivity(taskId: string, type: string, count = 1) {
  await vi.waitFor(
    async () =>
      expect(
        (await activityTypes(taskId)).filter((row) => row.type === type),
      ).toHaveLength(count),
    { timeout: 5000, interval: 25 },
  );
  return (await activityTypes(taskId)).filter((row) => row.type === type);
}

export async function notificationsFor(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.userId, userId));
}

/** Waits a little for background subscribers to settle. */
export function settle(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An API key of `user` with the given permission subset. */
export async function apiKeyFor(
  user: User,
  permissions: Record<string, string[]>,
) {
  mockAnonymousSession();
  const key = `margaya_test_${randomUUID()}`;
  await db.insert(schema.apikeyTable).values({
    referenceId: user.id,
    userId: user.id,
    key: createHash("sha256").update(key).digest("base64url"),
    name: "intake key",
    createdAt: new Date(),
    updatedAt: new Date(),
    permissions: JSON.stringify(permissions),
    enabled: true,
  });
  return { Authorization: `Bearer ${key}` };
}
