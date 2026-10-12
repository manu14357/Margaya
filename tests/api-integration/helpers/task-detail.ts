import { and, asc, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { subscribeToEvent } from "../../../apps/api/src/events";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { mockAuthenticatedSession } from "./auth";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";

export { json } from "./cycles";

type User = typeof schema.userTable.$inferSelect;

/** Every event published while a test runs, in order. */
const published: Array<{ name: string; data: Record<string, unknown> }> = [];
const watched = new Set<string>();

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

/**
 * A workspace with an owner-level admin, a member and a viewer, a project
 * (slug "web") and helpers to act as each of them.
 */
export async function taskDetailScene() {
  const admin = await createWorkspaceMember({ role: "admin", userName: "Ada" });
  const workspaceId = admin.workspace.id;
  const member = await addPerson(workspaceId, "Ben", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");
  const outsider = await createWorkspaceMember({ userName: "Oz" });
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "web",
  });
  const { app } = createApp();

  const numbers = new Map<string, number>();
  const createTask = async (
    overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const projectId = overrides.projectId ?? project.id;
    const number = (numbers.get(projectId) ?? 0) + 1;
    numbers.set(projectId, number);
    const status = overrides.status ?? "to-do";
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
        status,
        columnId: column?.id ?? null,
        description: "",
        ...overrides,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: number })
      .where(eq(schema.projectTable.id, projectId));
    return task;
  };

  const as = (user: User) => {
    const request = (path: string, init?: RequestInit) => {
      mockAuthenticatedSession(user);
      return app.request(`/api${path}`, init);
    };
    return request;
  };

  return {
    app,
    admin: admin.user,
    member,
    viewer,
    outsider: outsider.user,
    workspace: admin.workspace,
    project,
    columns,
    createTask,
    as,
  };
}

export async function activityRows(taskId: string, type?: string) {
  const rows = await db
    .select({
      id: schema.activityTable.id,
      type: schema.activityTable.type,
      userId: schema.activityTable.userId,
      eventData: schema.activityTable.eventData,
      createdAt: schema.activityTable.createdAt,
    })
    .from(schema.activityTable)
    .where(eq(schema.activityTable.taskId, taskId))
    .orderBy(asc(schema.activityTable.createdAt), asc(schema.activityTable.id));
  return type ? rows.filter((row) => row.type === type) : rows;
}

/** Waits until the background subscribers wrote `count` rows of `type`. */
export async function settledActivity(taskId: string, type: string, count = 1) {
  await vi.waitFor(
    async () => expect(await activityRows(taskId, type)).toHaveLength(count),
    { timeout: 5000, interval: 25 },
  );
  return activityRows(taskId, type);
}
