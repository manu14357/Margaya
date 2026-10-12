import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
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
type Project = typeof schema.projectTable.$inferSelect;
type TaskInsert = typeof schema.taskTable.$inferInsert;

export type QueryRow = {
  id: string;
  projectId: string;
  number: number | null;
  key: string;
  title: string;
  status: string;
  columnId: string | null;
  group: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  userId: string | null;
  position: number | null;
  assigneeIds?: string[];
  labels?: { name: string; color: string }[];
  cycleId?: string | null;
  moduleIds?: string[];
  estimatePointId?: string | null;
  parentId?: string | null;
  subTaskCount?: number;
  customFieldValues?: { fieldId: string; value: string }[];
  externalLinks?: { id: string; url: string }[];
};

export type QueryGroup = {
  key: string;
  count: number;
  taskIds?: string[];
  nextCursor: string | null;
  subGroups?: QueryGroup[];
};

export type QueryResult = {
  mode: string;
  groupBy: string | null;
  subGroupBy: string | null;
  today: string;
  totalCount: number;
  groups: QueryGroup[];
  hasMoreGroups: boolean;
  tasks: Record<string, QueryRow>;
  meta: {
    users: { id: string; name: string; image: string | null }[];
    projects: { id: string; slug: string; name: string }[];
    columns: { projectId: string; slug: string; group: string }[];
    labels: {
      key: string;
      name: string;
      color: string;
      workspaceLabelId: string | null;
    }[];
    cycles: { id: string; name: string; status: string }[];
    modules: { id: string; name: string; status: string }[];
    estimatePoints: { id: string; value: string; position: number }[];
    customFields: { id: string; name: string }[];
  };
  ids?: string[];
  truncated?: boolean;
};

/** Task ids of the one `all` group (ungrouped rows), in order. */
export function orderedIds(result: QueryResult): string[] {
  return result.groups.flatMap((group) => group.taskIds ?? []);
}

/** Group key to its task ids, for grouped results. */
export function idsByGroup(result: QueryResult): Record<string, string[]> {
  return Object.fromEntries(
    result.groups.map((group) => [group.key, group.taskIds ?? []]),
  );
}

export function countsByGroup(result: QueryResult): Record<string, number> {
  return Object.fromEntries(
    result.groups.map((group) => [group.key, group.count]),
  );
}

/**
 * A workspace with an owner (Olivia), members Ben and Cara, a viewer (Vic)
 * and a project "web" with the default columns. Tasks are inserted directly
 * so every fixture is hand-built and exact.
 */
export async function queryScene() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia",
  });
  const workspaceId = owner.workspace.id;
  const ben = await addPerson(workspaceId, "Ben", "member");
  const cara = await addPerson(workspaceId, "Cara", "member");
  const viewer = await addPerson(workspaceId, "Vic", "viewer");
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "web",
    name: "Web",
  });
  const { app } = createApp();
  mockAuthenticatedSession(owner.user);

  const numbers = new Map<string, number>();
  let clock = Date.parse("2026-01-01T00:00:00.000Z");

  /** Inserts a task; `createdAt` defaults to strictly increasing times. */
  const createTask = async (
    overrides: Partial<TaskInsert> & {
      assignees?: string[];
      labels?: string[];
    } = {},
  ) => {
    const { assignees, labels, ...values } = overrides;
    const projectId = values.projectId ?? project.id;
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
    clock += 60_000;
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
        createdAt: new Date(clock),
        updatedAt: new Date(clock),
        ...values,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    if (assignees) await assignTask(task.id, assignees);
    for (const name of labels ?? []) await labelTask(task.id, name);
    return task;
  };

  /** A workspace label (a row without a task). */
  const workspaceLabel = async (name: string, color = "#111111") => {
    const [label] = await db
      .insert(schema.labelTable)
      .values({ name, color, workspaceId })
      .returning();
    if (!label) throw new Error("Failed to create label");
    return label;
  };

  /** A label copy on a task, with the copy's own color. */
  const labelTask = async (taskId: string, name: string, color = "#999999") => {
    await db
      .insert(schema.labelTable)
      .values({ name, color, taskId, workspaceId });
  };

  const createProject = async (slug: string, name = slug) =>
    (await createProjectFixture({ workspaceId, slug, name })).project;

  const setFeatures = async (
    projectId: string,
    flags: Partial<
      Pick<Project, "cyclesEnabled" | "modulesEnabled" | "estimatesEnabled">
    >,
  ) => {
    await db
      .update(schema.projectTable)
      .set(flags)
      .where(eq(schema.projectTable.id, projectId));
  };

  const request = (body: Record<string, unknown>, user: User = owner.user) => {
    mockAuthenticatedSession(user);
    return app.request(
      "/api/task-query",
      json("POST", { workspaceId, ...body }),
    );
  };

  /** A query that must answer 200. */
  const query = async (
    body: Record<string, unknown> = {},
    user: User = owner.user,
  ): Promise<QueryResult> => {
    const response = await request(body, user);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as QueryResult;
  };

  /** A query that must fail with this status (and message, when given). */
  const refuse = async (
    body: Record<string, unknown>,
    status: number,
    message?: string,
  ) => {
    const response = await request(body);
    const text = await response.text();
    expect(response.status, text).toBe(status);
    if (message !== undefined) expect(text).toBe(message);
  };

  /** Matching task ids (ids mode), sorted. */
  const ids = async (
    filters: unknown,
    extra: Record<string, unknown> = {},
    user: User = owner.user,
  ) => {
    const result = await query({ mode: "ids", filters, ...extra }, user);
    return [...(result.ids ?? [])].sort();
  };

  return {
    app,
    workspaceId,
    workspace: owner.workspace,
    owner: owner.user,
    ben,
    cara,
    viewer,
    project,
    columns,
    createTask,
    createProject,
    workspaceLabel,
    labelTask,
    setFeatures,
    request,
    query,
    refuse,
    ids,
  };
}

/** Sorted copy, for comparing id sets. */
export function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}
