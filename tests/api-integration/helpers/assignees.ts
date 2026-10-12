import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
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

export type TaskJson = {
  id: string;
  userId: string | null;
  assigneeIds: string[];
  updatedAt?: string;
};

/** A user in the workspace with the given role and a recognizable name. */
export async function addPerson(
  workspaceId: string,
  name: string,
  role = "member",
) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name,
      image: `https://avatars.example.com/${id}.png`,
    })
    .returning();
  if (!user) throw new Error("Failed to create user");
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  return user;
}

/** Removes a user from a workspace, keeping their account. */
export async function removeFromWorkspace(userId: string, workspaceId: string) {
  await db
    .delete(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    );
}

/** The stored assignee rows of a task, in position order. */
export async function assigneeRows(taskId: string) {
  return db
    .select({
      userId: schema.taskAssigneeTable.userId,
      position: schema.taskAssigneeTable.position,
    })
    .from(schema.taskAssigneeTable)
    .where(eq(schema.taskAssigneeTable.taskId, taskId))
    .orderBy(asc(schema.taskAssigneeTable.position));
}

/** The stored task row (mirror and timestamps). */
export async function storedTask(taskId: string) {
  const [task] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  if (!task) throw new Error("Task not found");
  return task;
}

/**
 * A workspace (the caller's role), a project and a signed-in app. Tasks
 * are inserted directly; `assignees` seeds them consistently.
 */
export async function assigneeContext(role = "owner") {
  const actor = await createWorkspaceMember({ role, userName: "Actor Person" });
  const { project, columns } = await createProjectFixture({
    workspaceId: actor.workspace.id,
    slug: "asg",
  });
  mockAuthenticatedSession(actor.user);
  const { app } = createApp();

  let nextNumber = 1;
  const createTask = async (
    assignees: string[] = [],
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
        position: nextNumber,
        status,
        columnId: column?.id ?? null,
        ...overrides,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    if (assignees.length > 0) await assignTask(task.id, assignees);
    return task;
  };

  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `/api${path}`,
      body === undefined ? { method } : json(method, body),
    );

  return {
    ...actor,
    project,
    columns,
    app,
    createTask,
    call,
    person: (name: string, personRole = "member") =>
      addPerson(actor.workspace.id, name, personRole),
  };
}
