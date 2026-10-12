import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import { auth } from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import { subscribeToEvent } from "../../../apps/api/src/events";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { json } from "./cycles";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./fixtures";

export { json };

/** The editor's mention tag for a user. */
export function mentionOf(user: { id: string; name: string }) {
  return `<margaya-mention id="${user.id}" label="${user.name}"></margaya-mention>`;
}

/** Signs `user` in for the next app requests. */
export function signIn(user: User) {
  const now = new Date();
  return vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: {
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      userId: user.id,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user,
  });
}

/**
 * A workspace owned by Ada, members Ben and Cid, a project, a task factory
 * and a request helper that acts as a given user.
 */
export async function inboxScene() {
  const owner = await createWorkspaceMember({ role: "owner", userName: "Ada" });
  const workspace = owner.workspace;
  const ada = owner.user;
  const ben = await addPerson(workspace.id, "Ben");
  const cid = await addPerson(workspace.id, "Cid");
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "inb",
  });
  const { app } = createApp();

  // Direct inserts use high numbers so tasks made through the create
  // controller (which counts from the project) never collide.
  let nextNumber = 1000;
  const task = async (
    assignees: string[] = [],
    overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const [created] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        title: `Task ${nextNumber}`,
        number: nextNumber++,
        status: "to-do",
        ...overrides,
      })
      .returning();
    if (!created) throw new Error("Failed to create task");
    if (assignees.length > 0) await assignTask(created.id, assignees);
    return created;
  };

  const call = (user: User, method: string, path: string, body?: unknown) => {
    signIn(user);
    return app.request(
      `/api${path}`,
      body === undefined ? { method } : json(method, body),
    );
  };

  return {
    workspace,
    ada,
    ben,
    cid,
    project,
    columns,
    app,
    task,
    call,
    person: (name: string, role = "member") =>
      addPerson(workspace.id, name, role),
  };
}

export function notificationsOf(taskId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.resourceId, taskId));
}

/** Sorted [userId, type] pairs of a task's notifications. */
export async function recipientsOf(taskId: string) {
  return (await notificationsOf(taskId))
    .map((row) => [row.userId, row.type] as [string, string])
    .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`));
}

/** Waits until a task has exactly `count` notifications. */
export async function settledNotifications(taskId: string, count: number) {
  await vi.waitFor(
    async () => expect(await notificationsOf(taskId)).toHaveLength(count),
    { timeout: 5000, interval: 25 },
  );
  return recipientsOf(taskId);
}

export function sortedPairs(pairs: [string, string][]) {
  return [...pairs].sort((a, b) =>
    `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`),
  );
}

export async function subscriptionRow(taskId: string, userId: string) {
  const [row] = await db
    .select({
      subscribed: schema.taskSubscriberTable.subscribed,
      reason: schema.taskSubscriberTable.reason,
    })
    .from(schema.taskSubscriberTable)
    .where(
      and(
        eq(schema.taskSubscriberTable.taskId, taskId),
        eq(schema.taskSubscriberTable.userId, userId),
      ),
    );
  return row ?? null;
}

/** Waits for a subscription row to reach the expected state. */
export async function expectSubscription(
  taskId: string,
  userId: string,
  expected: { subscribed: boolean; reason: string } | null,
) {
  await vi.waitFor(
    async () => expect(await subscriptionRow(taskId, userId)).toEqual(expected),
    { timeout: 5000, interval: 25 },
  );
}

/** Collects the payloads of one event name while a test runs. */
export function recordEvents(eventName: string) {
  const seen: Record<string, unknown>[] = [];
  void subscribeToEvent<Record<string, unknown>>(eventName, async (data) => {
    seen.push(data);
  });
  return seen;
}
