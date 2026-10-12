import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { subscribeToEvent } from "../../../apps/api/src/events";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { mockAuthenticatedSession } from "./auth";
import { json } from "./cycles";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";

export { json } from "./cycles";

type User = typeof schema.userTable.$inferSelect;

export type PageCapabilitiesJson = {
  canEdit: boolean;
  canLock: boolean;
  canChangeAccess: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canMove: boolean;
  canCreateSubpage: boolean;
  canRestoreVersion: boolean;
};

export type PageSummaryJson = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  position: number;
  title: string;
  logoKind: "emoji" | "icon" | null;
  logoValue: string | null;
  access: "public" | "private";
  ownerId: string | null;
  isLocked: boolean;
  lockedById: string | null;
  lockedAt: string | null;
  archivedAt: string | null;
  isFullWidth: boolean;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: PageCapabilitiesJson;
};

export type PageJson = PageSummaryJson & {
  contentMarkdown: string;
  contentVersion: number;
  ancestors: Array<{ id: string; title: string }>;
};

export type PageVersionJson = {
  id: string;
  pageId: string;
  ownerId: string | null;
  contributorIds: string[];
  title: string;
  lastSavedAt: string;
  createdAt: string;
};

/** Every payload of the named events from now on. */
const recorded: Array<{ name: string; data: Record<string, unknown> }> = [];
const subscribed = new Set<string>();
export function recordPageEvents(...names: string[]) {
  for (const name of names) {
    if (subscribed.has(name)) continue;
    subscribed.add(name);
    void subscribeToEvent<Record<string, unknown>>(name, async (data) => {
      recorded.push({ name, data });
    });
  }
}
export function pageEvents(name?: string) {
  return recorded.filter((event) => !name || event.name === name);
}
export function clearPageEvents() {
  recorded.length = 0;
}

export async function pageRow(pageId: string) {
  const [row] = await db
    .select()
    .from(schema.pageTable)
    .where(eq(schema.pageTable.id, pageId));
  return row;
}

export async function setPagesEnabled(projectId: string, enabled: boolean) {
  await db
    .update(schema.projectTable)
    .set({ pagesEnabled: enabled })
    .where(eq(schema.projectTable.id, projectId));
}

/**
 * A workspace with an owner (Olivia), an admin (Ada), members Ben and Cara,
 * a viewer (Vic) and a project "web". `call` sends a request to /api/page
 * as the given user.
 */
export async function pageScene() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia",
  });
  const workspaceId = owner.workspace.id;
  const admin = await addPerson(workspaceId, "Ada", "admin");
  const ben = await addPerson(workspaceId, "Ben", "member");
  const cara = await addPerson(workspaceId, "Cara", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");
  const { project } = await createProjectFixture({ workspaceId, slug: "web" });
  const { app } = createApp();

  const call = (user: User, path: string, init?: RequestInit) => {
    mockAuthenticatedSession(user);
    return app.request(`/api/page${path}`, init);
  };

  /** Creates a page as `user`; fails the test unless it answers 200. */
  const create = async (
    user: User,
    body: Record<string, unknown> = {},
    projectId = project.id,
  ) => {
    const response = await call(
      user,
      `/project/${projectId}`,
      json("POST", body),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as PageJson;
  };

  const get = async (user: User, pageId: string) => {
    const response = await call(user, `/${pageId}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as PageJson;
  };

  const list = async (user: User, projectId = project.id) => {
    const response = await call(user, `/project/${projectId}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as PageSummaryJson[];
  };

  /** Sends a request expected to succeed, returning the JSON. */
  const ok = async <T = PageJson>(
    user: User,
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    const response = await call(user, path, init);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as T;
  };

  const project2 = async (slug = "api") =>
    (await createProjectFixture({ workspaceId, slug })).project;

  return {
    app,
    workspaceId,
    project,
    owner: owner.user,
    admin,
    ben,
    cara,
    viewer,
    call,
    create,
    get,
    list,
    ok,
    project2,
  };
}

export type PageScene = Awaited<ReturnType<typeof pageScene>>;
