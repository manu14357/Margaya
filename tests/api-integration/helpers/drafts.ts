import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { mockAuthenticatedSession } from "./auth";
import { day, json } from "./cycles";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";

export { day, json };

type User = typeof schema.userTable.$inferSelect;

export type DraftJson = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    archived: boolean;
  } | null;
  title: string;
  description?: string;
  hasDescription?: boolean;
  status: string | null;
  priority: string;
  assigneeIds: string[];
  labels: { name: string; color: string }[];
  startDate: string | null;
  dueDate: string | null;
  customFieldValues: { fieldId: string; value: string }[];
  cycleId: string | null;
  moduleIds: string[];
  estimatePointId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DraftListJson = {
  drafts: DraftJson[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

export type PublishedJson = {
  task: {
    id: string;
    projectId: string;
    number: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    userId: string | null;
    assigneeIds: string[];
    createdBy: string | null;
    startDate: string | null;
    dueDate: string | null;
    estimatePointId: string | null;
  };
  key: string;
  dropped: string[];
};

/**
 * A workspace with Mia (member, the draft author), Ada (admin), Owen
 * (owner) and Vic (viewer), an outsider in another workspace, and two
 * projects: "web" and "api".
 */
export async function draftScene() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Owen",
  });
  const workspaceId = owner.workspace.id;
  const mia = await addPerson(workspaceId, "Mia", "member");
  const ada = await addPerson(workspaceId, "Ada", "admin");
  const vic = await addPerson(workspaceId, "Vic", "viewer");
  const outsider = await createWorkspaceMember({ userName: "Oz" });
  const web = await createProjectFixture({ workspaceId, slug: "web" });
  const api = await createProjectFixture({ workspaceId, slug: "api" });
  const { app } = createApp();

  const as =
    (user: User) =>
    (
      method: string,
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ): Promise<Response> => {
      mockAuthenticatedSession(user);
      const init = body === undefined ? { method } : json(method, body);
      return app.request(
        `/api${path}`,
        headers
          ? { ...init, headers: { ...(init.headers as object), ...headers } }
          : init,
      );
    };

  /** A request that must answer 200; returns the parsed body. */
  const ok = async <T>(
    user: User,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await as(user)(method, path, body);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as T;
  };

  const createDraft = (user: User, body: Record<string, unknown> = {}) =>
    ok<DraftJson>(user, "POST", "/task-draft", { workspaceId, ...body });

  const insertCycle = async (
    overrides: Partial<typeof schema.cycleTable.$inferInsert> = {},
  ) => {
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: web.project.id,
        name: "Sprint",
        startDate: day(-3),
        endDate: day(10),
        ...overrides,
      })
      .returning();
    if (!cycle) throw new Error("Failed to create cycle");
    return cycle;
  };

  const insertModule = async (
    overrides: Partial<typeof schema.moduleTable.$inferInsert> = {},
  ) => {
    const [module] = await db
      .insert(schema.moduleTable)
      .values({
        projectId: web.project.id,
        name: `Module ${Math.random().toString(36).slice(2, 8)}`,
        status: "in-progress",
        ...overrides,
      })
      .returning();
    if (!module) throw new Error("Failed to create module");
    return module;
  };

  /** An active estimate system of the project with points 1, 2 and 3. */
  const insertEstimate = async (projectId = web.project.id, active = true) => {
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: true })
      .where(eq(schema.projectTable.id, projectId));
    const [estimate] = await db
      .insert(schema.estimateTable)
      .values({
        projectId,
        name: `Points ${Math.random().toString(36).slice(2, 8)}`,
        type: "points",
        isActive: active,
      })
      .returning();
    if (!estimate) throw new Error("Failed to create estimate");
    const points = await db
      .insert(schema.estimatePointTable)
      .values(
        ["1", "2", "3"].map((value, index) => ({
          estimateId: estimate.id,
          value,
          numericValue: Number(value),
          position: index + 1,
        })),
      )
      .returning();
    return { estimate, points };
  };

  const insertField = async (
    overrides: Partial<
      typeof schema.customFieldDefinitionTable.$inferInsert
    > = {},
  ) => {
    const [field] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: web.project.id,
        name: "Team",
        type: "dropdown",
        options: ["Core", "Growth"],
        ...overrides,
      })
      .returning();
    if (!field) throw new Error("Failed to create field");
    return field;
  };

  const draftRow = async (id: string) => {
    const [row] = await db
      .select()
      .from(schema.taskDraftTable)
      .where(eq(schema.taskDraftTable.id, id));
    return row ?? null;
  };

  const lastTaskNumber = async (projectId = web.project.id) => {
    const [row] = await db
      .select({ value: schema.projectTable.lastTaskNumber })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId));
    return row?.value ?? 0;
  };

  return {
    app,
    workspaceId,
    workspace: owner.workspace,
    owner: owner.user,
    mia,
    ada,
    vic,
    outsider: outsider.user,
    outsiderWorkspaceId: outsider.workspace.id,
    web,
    api,
    as,
    ok,
    createDraft,
    insertCycle,
    insertModule,
    insertEstimate,
    insertField,
    draftRow,
    lastTaskNumber,
  };
}
