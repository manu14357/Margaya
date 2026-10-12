import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { addPerson } from "./assignees";
import { mockAuthenticatedSession } from "./auth";
import { json } from "./cycles";
import { createProjectFixture, createWorkspaceMember } from "./fixtures";

export { json } from "./cycles";

type User = typeof schema.userTable.$inferSelect;

export type ViewUserJson = { id: string; name: string; image: string | null };

export type SavedViewJson = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string;
  filters: { version: 1; root: unknown; archived: string };
  display: {
    layout: string;
    groupBy: string | null;
    subGroupBy: string | null;
    orderBy: { field: string; direction: string };
    showSubTasks: boolean;
    showEmptyGroups: boolean;
  };
  displayProperties: Record<string, boolean | string[]>;
  access: "private" | "workspace";
  isLocked: boolean;
  lockedBy: ViewUserJson | null;
  ownerId: string | null;
  owner: ViewUserJson | null;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * A workspace with an owner (Olivia), an admin (Ada), members Ben and Cara,
 * a viewer (Vic) and a project "web" with the default columns. `call` sends
 * a request to /api/view as the given user.
 */
export async function viewScene() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia",
  });
  const workspaceId = owner.workspace.id;
  const admin = await addPerson(workspaceId, "Ada", "admin");
  const ben = await addPerson(workspaceId, "Ben", "member");
  const cara = await addPerson(workspaceId, "Cara", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "web",
  });
  const { app } = createApp();

  const call = (user: User, path: string, init?: RequestInit) => {
    mockAuthenticatedSession(user);
    return app.request(`/api/view${path}`, init);
  };

  /** Creates a view as `user`; fails the test unless it answers 200. */
  const create = async (user: User, body: Record<string, unknown>) => {
    const response = await call(
      user,
      "",
      json("POST", { workspaceId, name: "View", ...body }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as SavedViewJson;
  };

  const list = async (user: User, query = "") => {
    const response = await call(user, `?workspaceId=${workspaceId}${query}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as SavedViewJson[];
  };

  const project2 = async (slug = "api") =>
    (await createProjectFixture({ workspaceId, slug })).project;

  const insertCycle = async (projectId: string, name = "Sprint 1") => {
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({ projectId, name })
      .returning();
    if (!cycle) throw new Error("fixture");
    return cycle;
  };

  const insertModule = async (projectId: string, name = "Billing") => {
    const [module] = await db
      .insert(schema.moduleTable)
      .values({ projectId, name })
      .returning();
    if (!module) throw new Error("fixture");
    return module;
  };

  const insertWorkspaceLabel = async (
    name: string,
    labelWorkspace = workspaceId,
  ) => {
    const [label] = await db
      .insert(schema.labelTable)
      .values({ name, color: "#ff0000", workspaceId: labelWorkspace })
      .returning();
    if (!label) throw new Error("fixture");
    return label;
  };

  const insertCustomField = async (projectId: string, name = "Team") => {
    const [field] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId, name, type: "text" })
      .returning();
    if (!field) throw new Error("fixture");
    return field;
  };

  const insertEstimatePoint = async (projectId: string) => {
    const [estimate] = await db
      .insert(schema.estimateTable)
      .values({ projectId, name: "Points", type: "points", isActive: true })
      .returning();
    if (!estimate) throw new Error("fixture");
    const [point] = await db
      .insert(schema.estimatePointTable)
      .values({
        estimateId: estimate.id,
        value: "3",
        numericValue: 3,
        position: 1,
      })
      .returning();
    if (!point) throw new Error("fixture");
    return point;
  };

  let nextNumber = 1;
  const insertTask = async (projectId: string, title = "Task") => {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title,
        number: nextNumber++,
        status: "to-do",
        columnId: columns.todo.id,
      })
      .returning();
    if (!task) throw new Error("fixture");
    return task;
  };

  return {
    app,
    workspaceId,
    owner: owner.user,
    admin,
    ben,
    cara,
    viewer,
    project,
    columns,
    call,
    create,
    list,
    project2,
    insertCycle,
    insertModule,
    insertWorkspaceLabel,
    insertCustomField,
    insertEstimatePoint,
    insertTask,
  };
}
