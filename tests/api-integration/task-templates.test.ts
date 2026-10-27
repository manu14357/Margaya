import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type TemplateJson = {
  id: string;
  projectId: string;
  name: string;
  titlePattern: string;
  columnId: string | null;
  priority: string | null;
  labels: { id: string; name: string; color: string }[];
  assigneeIds: string[];
  subtasks: string[];
};

async function templateScene() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const workspaceId = admin.workspace.id;
  const member = await addWorkspaceMember(workspaceId, "member");
  const viewer = await addWorkspaceMember(workspaceId, "viewer");
  const outsider = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "tpl",
  });
  const [bug] = await db
    .insert(schema.labelTable)
    .values({ name: "Bug", color: "red", workspaceId })
    .returning();
  const [foreignLabel] = await db
    .insert(schema.labelTable)
    .values({
      name: "Other",
      color: "gray",
      workspaceId: outsider.workspace.id,
    })
    .returning();
  if (!bug || !foreignLabel) throw new Error("labels");
  const { app } = createApp();

  const as = async (
    user: { id: string },
    method: string,
    path: string,
    body?: unknown,
  ) => {
    mockAuthenticatedSession(user as never);
    return app.request(
      `/api${path}`,
      body === undefined ? { method } : json(method, body),
    );
  };
  const createAsAdmin = async (body: Record<string, unknown>) => {
    const response = await as(admin.user, "POST", "/task-template", {
      projectId: project.id,
      ...body,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as TemplateJson;
  };

  return {
    admin,
    member,
    viewer,
    outsider,
    workspaceId,
    project,
    columns,
    bug,
    foreignLabel,
    app,
    as,
    createAsAdmin,
  };
}

describe("API integration: task templates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets project:update manage templates and project:read list them", async () => {
    const s = await templateScene();
    const body = { projectId: s.project.id, name: "Bug report" };

    expect((await s.as(s.member, "POST", "/task-template", body)).status).toBe(
      403,
    );
    expect((await s.as(s.viewer, "POST", "/task-template", body)).status).toBe(
      403,
    );
    expect(
      (await s.as(s.outsider.user, "POST", "/task-template", body)).status,
    ).toBe(403);

    const template = await s.createAsAdmin({
      name: "Bug report",
      titlePattern: "Bug: {title}",
      columnId: s.columns.inProgress.id,
      priority: "high",
      labelIds: [s.bug.id],
      assigneeIds: [s.member.id],
      subtasks: ["Reproduce", "Fix"],
    });

    for (const user of [s.member, s.viewer]) {
      const list = await s.as(
        user,
        "GET",
        `/task-template/project/${s.project.id}`,
      );
      expect(list.status).toBe(200);
      expect(((await list.json()) as TemplateJson[]).map((t) => t.id)).toEqual([
        template.id,
      ]);
    }
    expect(
      (
        await s.as(
          s.outsider.user,
          "GET",
          `/task-template/project/${s.project.id}`,
        )
      ).status,
    ).toBe(403);

    for (const [method, path, payload] of [
      ["PATCH", `/task-template/${template.id}`, { name: "X" }],
      ["DELETE", `/task-template/${template.id}`, undefined],
    ] as const) {
      expect((await s.as(s.member, method, path, payload)).status).toBe(403);
      expect((await s.as(s.outsider.user, method, path, payload)).status).toBe(
        403,
      );
    }
    expect(
      (
        await s.as(s.admin.user, "PATCH", `/task-template/${template.id}`, {
          name: "Bug",
        })
      ).status,
    ).toBe(200);
  });

  it("rejects references outside the project or workspace, and duplicate names", async () => {
    const s = await templateScene();
    const other = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "oth",
    });
    const post = (body: Record<string, unknown>) =>
      s.as(s.admin.user, "POST", "/task-template", {
        projectId: s.project.id,
        name: "T",
        ...body,
      });

    expect((await post({ columnId: other.columns.todo.id })).status).toBe(400);
    expect((await post({ labelIds: [s.foreignLabel.id] })).status).toBe(400);
    expect((await post({ assigneeIds: [s.outsider.user.id] })).status).toBe(
      403,
    );
    await s.createAsAdmin({ name: "Same" });
    expect((await post({ name: "same" })).status).toBe(409);
  });

  it("creates tasks from a template with task:create, sub-tasks included", async () => {
    const s = await templateScene();
    const template = await s.createAsAdmin({
      name: "Bug report",
      titlePattern: "Bug: {title}",
      description: "Steps",
      columnId: s.columns.inProgress.id,
      priority: "high",
      labelIds: [s.bug.id],
      assigneeIds: [s.member.id],
      subtasks: ["Reproduce", "Fix"],
    });
    const apply = (user: { id: string }, body: Record<string, unknown> = {}) =>
      s.as(user, "POST", `/task-template/${template.id}/apply`, body);

    expect((await apply(s.viewer, { title: "x" })).status).toBe(403);
    expect((await apply(s.outsider.user, { title: "x" })).status).toBe(403);

    const response = await apply(s.member, { title: "Login fails" });
    expect(response.status, await response.clone().text()).toBe(200);
    const task = (await response.json()) as {
      id: string;
      title: string;
      status: string;
      priority: string;
      subtaskIds: string[];
    };
    expect(task).toMatchObject({
      title: "Bug: Login fails",
      status: "in-progress",
      priority: "high",
    });
    expect(task.subtaskIds).toHaveLength(2);

    const labels = await db
      .select({ name: schema.labelTable.name })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, task.id));
    expect(labels.map((label) => label.name)).toEqual(["Bug"]);
    const assignees = await db
      .select({ userId: schema.taskAssigneeTable.userId })
      .from(schema.taskAssigneeTable)
      .where(eq(schema.taskAssigneeTable.taskId, task.id));
    expect(assignees.map((row) => row.userId)).toEqual([s.member.id]);
    const children = await db
      .select({ id: schema.taskRelationTable.targetTaskId })
      .from(schema.taskRelationTable)
      .where(
        and(
          eq(schema.taskRelationTable.sourceTaskId, task.id),
          eq(schema.taskRelationTable.relationType, "subtask"),
        ),
      );
    expect(children.map((row) => row.id).sort()).toEqual(
      [...task.subtaskIds].sort(),
    );

    // A status override wins over the template's column.
    const todo = await apply(s.member, { title: "Two", status: "to-do" });
    expect(((await todo.json()) as { status: string }).status).toBe("to-do");
  });

  it("drops stale references on read", async () => {
    const s = await templateScene();
    const template = await s.createAsAdmin({
      name: "T",
      labelIds: [s.bug.id],
      assigneeIds: [s.member.id],
    });
    await db
      .delete(schema.labelTable)
      .where(eq(schema.labelTable.id, s.bug.id));
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.member.id));

    const list = await s.as(
      s.admin.user,
      "GET",
      `/task-template/project/${s.project.id}`,
    );
    const [read] = (await list.json()) as TemplateJson[];
    expect(read?.id).toBe(template.id);
    expect(read?.labels).toEqual([]);
    expect(read?.assigneeIds).toEqual([]);
  });
});

describe("API integration: create project from an existing project", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("copies the setup and templates, and tasks only when asked", async () => {
    const s = await templateScene();
    await db.insert(schema.customFieldDefinitionTable).values({
      projectId: s.project.id,
      name: "Severity",
      type: "text",
    });
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: true, modulesEnabled: false })
      .where(eq(schema.projectTable.id, s.project.id));
    await s.createAsAdmin({ name: "Bug", columnId: s.columns.inReview.id });
    const [open] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.project.id,
        number: 1,
        title: "Open work",
        status: "to-do",
        columnId: s.columns.todo.id,
      })
      .returning();
    await db.insert(schema.taskTable).values({
      projectId: s.project.id,
      number: 2,
      title: "Finished",
      status: "done",
      columnId: s.columns.done.id,
    });
    if (!open) throw new Error("task");

    const create = (user: { id: string }, body: Record<string, unknown>) =>
      s.as(user, "POST", "/project", {
        workspaceId: s.workspaceId,
        name: "Copy",
        icon: "Layout",
        ...body,
      });

    const plain = await create(s.admin.user, {
      slug: "cp1",
      fromProjectId: s.project.id,
    });
    expect(plain.status, await plain.clone().text()).toBe(200);
    const copy = (await plain.json()) as { id: string };
    const [copied] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, copy.id));
    expect(copied).toMatchObject({
      estimatesEnabled: true,
      modulesEnabled: false,
    });
    const copiedColumns = await db
      .select({ slug: schema.columnTable.slug })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, copy.id));
    expect(copiedColumns.map((c) => c.slug).sort()).toEqual(
      ["done", "in-progress", "in-review", "to-do"].sort(),
    );
    const fields = await db
      .select()
      .from(schema.customFieldDefinitionTable)
      .where(eq(schema.customFieldDefinitionTable.projectId, copy.id));
    expect(fields.map((f) => f.name)).toEqual(["Severity"]);
    const copiedTasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, copy.id));
    expect(copiedTasks).toEqual([]);
    const noTemplates = await db
      .select()
      .from(schema.taskTemplateTable)
      .where(eq(schema.taskTemplateTable.projectId, copy.id));
    expect(noTemplates).toEqual([]);

    const full = await create(s.admin.user, {
      slug: "cp2",
      fromProjectId: s.project.id,
      copy: { taskTemplates: true, openTasks: true },
    });
    expect(full.status, await full.clone().text()).toBe(200);
    const fullId = ((await full.json()) as { id: string }).id;
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, fullId));
    expect(tasks.map((task) => task.title)).toEqual(["Open work"]);
    const [template] = await db
      .select()
      .from(schema.taskTemplateTable)
      .where(eq(schema.taskTemplateTable.projectId, fullId));
    const [reviewColumn] = await db
      .select()
      .from(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, fullId),
          eq(schema.columnTable.slug, "in-review"),
        ),
      );
    expect(template?.columnId).toBe(reviewColumn?.id);
  });

  it("refuses sources from other workspaces and enforces permissions", async () => {
    const s = await templateScene();
    const foreign = await createProjectFixture({
      workspaceId: s.outsider.workspace.id,
      slug: "frn",
    });
    const create = (user: { id: string }, body: Record<string, unknown>) =>
      s.as(user, "POST", "/project", {
        workspaceId: s.workspaceId,
        name: "Copy",
        icon: "Layout",
        ...body,
      });

    expect(
      (
        await create(s.admin.user, {
          slug: "x1",
          fromProjectId: foreign.project.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (await create(s.viewer, { slug: "x2", fromProjectId: s.project.id }))
        .status,
    ).toBe(403);
    expect(
      (await create(s.admin.user, { slug: "x3", copy: { openTasks: true } }))
        .status,
    ).toBe(400);
  });
});
