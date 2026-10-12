import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { clearBoardListCache } from "../../../apps/api/src/public-board/cache";
import {
  type PublicBoardInstanceState,
  setPublicBoardInstanceState,
} from "../../../apps/api/src/public-board/instance-state";
import { resetRateLimitMemory } from "../../../apps/api/src/utils/rate-limit";
import { addPerson } from "./assignees";
import { mockAnonymousSession, mockAuthenticatedSession } from "./auth";
import { json } from "./cycles";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";
import { setIntakeEnabled } from "./intake";

export { json } from "./cycles";

type User = typeof schema.userTable.$inferSelect;

export const ALL_ON = {
  commentsEnabled: true,
  reactionsEnabled: true,
  votesEnabled: true,
  requestsEnabled: true,
  allowGuests: true,
};

/** Fresh limiter, cache and server switches for every test. */
export function resetPublicBoardState(
  instance: Partial<PublicBoardInstanceState> = {},
) {
  resetRateLimitMemory();
  clearBoardListCache();
  setPublicBoardInstanceState(() => ({
    publicBoards: true,
    participation: true,
    guestAccessActive: true,
    instanceName: "Margaya",
    signUpAvailable: true,
    ...instance,
  }));
}

export async function createUser(
  name: string,
  extra: Partial<typeof schema.userTable.$inferInsert> = {},
): Promise<User> {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name,
      image: `https://avatars.example.com/${randomUUID()}.png`,
      ...extra,
    })
    .returning();
  if (!user) throw new Error("Failed to create user");
  return user;
}

/**
 * A workspace with an owner (Ada) and a member (Ben), an outside account
 * (Oz), a guest account (Gus) and a project "web" with intake on.
 */
export async function boardScene() {
  const owner = await createWorkspaceMember({ role: "owner", userName: "Ada" });
  const workspaceId = owner.workspace.id;
  const member = await addPerson(workspaceId, "Ben", "member");
  const outsider = await createUser("Oz");
  const guest = await createUser("Gus", { isAnonymous: true });
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "web",
  });
  await setIntakeEnabled(project.id, true);
  const { app } = createApp();
  // Clear of claimTaskNumber's sequence, which starts at 1.
  let nextNumber = 1000;

  /** A request as this user (null: a visitor without a session). */
  const as =
    (user: User | null) =>
    (path: string, init?: RequestInit): Promise<Response> => {
      if (user) mockAuthenticatedSession(user);
      else mockAnonymousSession();
      return app.request(`/api${path}`, init);
    };

  async function publish(settings: Record<string, unknown> = ALL_ON) {
    const response = await as(owner.user)(
      `/publication/project/${project.id}/publish`,
      json("POST", settings),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { linkToken: string };
    return body.linkToken;
  }

  async function createTask(
    title: string,
    values: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title,
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: nextNumber++,
        position: 0,
        ...values,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    return task;
  }

  return {
    app,
    as,
    owner: owner.user,
    member,
    outsider,
    guest,
    workspaceId,
    project,
    columns,
    publish,
    createTask,
  };
}

/** Every string anywhere in a JSON value (keys included). */
export function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => [
      key,
      ...jsonStrings(entry),
    ]);
  }
  return [];
}
