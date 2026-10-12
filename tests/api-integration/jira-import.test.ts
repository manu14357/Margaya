import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray } from "drizzle-orm";
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

const FIXTURE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/jira-export.csv"),
  "utf8",
);

type ImportResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  comments: number;
  relations: number;
  unmatchedPeople: string[];
  errors: Array<{ line: number; key: string; message: string }>;
  warnings: Array<{ message: string; count: number }>;
};

async function scene(role = "owner") {
  const { user, workspace } = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "web",
  });
  const ben = await addWorkspaceMember(workspace.id, "member");
  await db
    .update(schema.userTable)
    .set({ name: "Ben Builder", email: "ben@example.test" })
    .where(eq(schema.userTable.id, ben.id));
  mockAuthenticatedSession(user);
  const { app } = createApp();
  const post = (path: string, body: unknown) =>
    app.request(`/api/jira-import/${project.id}${path}`, json("POST", body));
  const runImport = async (
    options: Record<string, unknown> = {},
    content = FIXTURE,
  ) => {
    const response = await post("", { content, timeZone: "UTC", options });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ImportResult;
  };
  return { user, workspace, project, columns, ben, app, post, runImport };
}

async function tasksByKey(projectId: string) {
  const rows = await db
    .select({ key: schema.activityTable.externalUrl, task: schema.taskTable })
    .from(schema.activityTable)
    .innerJoin(
      schema.taskTable,
      eq(schema.taskTable.id, schema.activityTable.taskId),
    )
    .where(
      and(
        eq(schema.taskTable.projectId, projectId),
        eq(schema.activityTable.type, "imported"),
      ),
    );
  return new Map(rows.map((row) => [row.key ?? "", row.task]));
}

async function labelNames(taskId: string) {
  const rows = await db
    .select({ name: schema.labelTable.name })
    .from(schema.labelTable)
    .where(eq(schema.labelTable.taskId, taskId));
  return rows.map((row) => row.name).sort();
}

async function relationsOf(taskIds: string[]) {
  return db
    .select({
      source: schema.taskRelationTable.sourceTaskId,
      target: schema.taskRelationTable.targetTaskId,
      type: schema.taskRelationTable.relationType,
    })
    .from(schema.taskRelationTable)
    .where(inArray(schema.taskRelationTable.sourceTaskId, taskIds));
}

async function commentsOf(taskId: string) {
  return db
    .select({
      content: schema.activityTable.content,
      author: schema.activityTable.externalUserName,
      source: schema.activityTable.externalSource,
      createdAt: schema.activityTable.createdAt,
    })
    .from(schema.activityTable)
    .where(
      and(
        eq(schema.activityTable.taskId, taskId),
        eq(schema.activityTable.type, "comment"),
      ),
    )
    .orderBy(asc(schema.activityTable.createdAt));
}

describe("API integration: importing a Jira CSV export", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("previews the file: columns, statuses, priorities and people", async () => {
    const { post, ben } = await scene();
    const response = await post("/preview", { content: FIXTURE });
    expect(response.status).toBe(200);
    const preview = await response.json();

    expect(preview.issueCount).toBe(5);
    expect(preview.columns).toContainEqual({ name: "Labels", count: 2 });
    expect(preview.columns).toContainEqual({ name: "Comment", count: 2 });
    expect(preview.statuses).toContainEqual({
      name: "Selected for Development",
      count: 1,
      category: "To Do",
      suggestedStatus: "to-do",
    });
    expect(preview.statuses).toContainEqual(
      expect.objectContaining({ name: "Done", suggestedStatus: "done" }),
    );
    expect(preview.priorities).toContainEqual({
      name: "Highest",
      count: 1,
      suggestedPriority: "urgent",
    });
    const people = new Map(
      preview.people.map((person: { name: string; member: unknown }) => [
        person.name,
        person.member,
      ]),
    );
    expect(people.get("ben@example.test")).toMatchObject({ id: ben.id });
    expect(people.get("Ben Builder")).toMatchObject({ id: ben.id });
    expect(people.get("Grace Ghost")).toBeNull();
    expect(preview.totals).toMatchObject({
      comments: 3,
      attachments: 1,
      subtasks: 1,
      alreadyImported: 0,
    });
    expect(preview.permissions).toEqual({
      update: true,
      comments: true,
      cycles: true,
      modules: true,
    });
    expect(preview.warnings).toContainEqual({
      message: "Rows without a Summary are skipped",
      count: 1,
    });
  });

  it("creates tasks with labels, sub-tasks, relations and comments", async () => {
    const { project, columns, ben, user, runImport } = await scene();
    const result = await runImport();

    expect(result).toMatchObject({
      total: 5,
      created: 4,
      updated: 0,
      skipped: 0,
      failed: 1,
      comments: 3,
      relations: 4,
      unmatchedPeople: ["Grace Ghost"],
    });
    expect(result.errors).toEqual([
      { line: 14, key: "WEB-5", message: "The issue has no Summary" },
    ]);
    expect(result.warnings.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        "Attachments aren't downloaded; their names and links are listed in the description",
        "Estimates skipped: the project's Estimates feature is off",
      ]),
    );

    const tasks = await tasksByKey(project.id);
    const web1 = tasks.get("WEB-1");
    const web2 = tasks.get("WEB-2");
    const web3 = tasks.get("WEB-3");
    const web4 = tasks.get("WEB-4");
    if (!web1 || !web2 || !web3 || !web4) throw new Error("missing tasks");

    expect(web1).toMatchObject({
      title: "Checkout redesign",
      status: "in-progress",
      columnId: columns.inProgress.id,
      priority: "urgent",
      userId: ben.id,
      createdBy: ben.id,
    });
    expect(web1.createdAt.toISOString()).toBe("2024-01-02T09:15:00.000Z");
    expect(web1.dueDate?.toISOString()).toBe("2024-01-31T00:00:00.000Z");
    expect(web1.description).toBe(
      [
        "## Goal",
        "Make **checkout** faster.",
        "",
        "1. Measure",
        "1. Ship `v2`",
        "",
        "See [the spec](https://docs.example.test/checkout).",
        "",
        "**Attachments in Jira (not imported)**",
        "",
        "- [mockup.png](https://jira.example.test/secure/attachment/1/mockup.png)",
      ].join("\n"),
    );
    expect(await labelNames(web1.id)).toEqual([
      "Story",
      "checkout",
      "frontend",
    ]);
    expect(web2).toMatchObject({ userId: null, createdBy: user.id });
    expect(web3).toMatchObject({ status: "done", priority: "low" });
    expect(web3.completedAt).not.toBeNull();
    expect(web3.description).toBe(
      "| Case | Expected |\n| --- | --- |\n| 1 item | **10** |",
    );
    expect(web4).toMatchObject({ status: "to-do", priority: "low" });

    // Workspace labels exist for the new names.
    const roots = await db
      .select({ name: schema.labelTable.name })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.workspaceId, project.workspaceId));
    expect(roots.map((row) => row.name)).toEqual(
      expect.arrayContaining(["frontend", "Sub-task", "regression"]),
    );

    const relations = await relationsOf([web1.id, web4.id]);
    expect(relations).toEqual(
      expect.arrayContaining([
        { source: web1.id, target: web2.id, type: "subtask" },
        { source: web1.id, target: web3.id, type: "blocks" },
        { source: web1.id, target: web4.id, type: "related" },
        { source: web4.id, target: web3.id, type: "duplicate" },
      ]),
    );
    expect(relations).toHaveLength(4);

    expect(await commentsOf(web1.id)).toEqual([
      {
        content: "Started on the *layout*.",
        author: "Ben Builder",
        source: "jira",
        createdAt: new Date("2024-01-03T10:00:00.000Z"),
      },
      {
        content: "Please keep the old flow; we need it.",
        author: "Grace Ghost",
        source: "jira",
        createdAt: new Date("2024-01-04T11:30:00.000Z"),
      },
    ]);
    expect((await commentsOf(web2.id))[0]?.content).toBe("Line one\nline two");

    // Imported conversations notify nobody.
    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "task_comment"));
    expect(notifications).toEqual([]);
  });

  it("skips issues imported before, or updates them on request", async () => {
    const { project, runImport } = await scene();
    await runImport();
    const before = await tasksByKey(project.id);

    const again = await runImport();
    expect(again).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 4,
      failed: 1,
      comments: 0,
      relations: 0,
    });
    const tasks = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    expect(tasks).toHaveLength(4);

    const edited = FIXTURE.replace(
      "Checkout redesign,WEB-1",
      "Checkout redesign v2,WEB-1",
    ).replace(
      ',"04/Jan/24 11:30 AM;acc-grace;Please keep the old flow; we need it."',
      ',"07/Jan/24 9:00 AM;acc-grace;Shipped."',
    );
    const updated = await runImport({ mode: "update" }, edited);
    expect(updated).toMatchObject({
      created: 0,
      updated: 4,
      skipped: 0,
      comments: 1,
      relations: 0,
    });
    const after = await tasksByKey(project.id);
    const web1 = after.get("WEB-1");
    expect(web1?.id).toBe(before.get("WEB-1")?.id);
    expect(web1?.title).toBe("Checkout redesign v2");
    // Old comments stay; the new one is added once.
    expect(
      (await commentsOf(web1?.id ?? "")).map((comment) => comment.content),
    ).toEqual([
      "Started on the *layout*.",
      "Please keep the old flow; we need it.",
      "Shipped.",
    ]);
  });

  it("puts sprints in cycles and components in modules when asked", async () => {
    const { project, runImport } = await scene();
    const result = await runImport({
      sprintsAsCycles: true,
      componentsAsModules: true,
    });
    expect(result.created).toBe(4);

    const cycles = await db
      .select({ id: schema.cycleTable.id, name: schema.cycleTable.name })
      .from(schema.cycleTable)
      .where(eq(schema.cycleTable.projectId, project.id));
    expect(cycles.map((cycle) => cycle.name)).toEqual(["Sprint 2"]);
    const modules = await db
      .select({ name: schema.moduleTable.name })
      .from(schema.moduleTable)
      .where(eq(schema.moduleTable.projectId, project.id));
    expect(modules.map((module) => module.name).sort()).toEqual(["API", "Web"]);

    const tasks = await tasksByKey(project.id);
    const members = await db
      .select({ taskId: schema.cycleTaskTable.taskId })
      .from(schema.cycleTaskTable)
      .where(eq(schema.cycleTaskTable.cycleId, cycles[0]?.id ?? ""));
    expect(members.map((row) => row.taskId).sort()).toEqual(
      [tasks.get("WEB-1")?.id, tasks.get("WEB-2")?.id].sort(),
    );
  });

  it("skips sprints, components and estimates for features that are off", async () => {
    const { project, runImport } = await scene();
    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false, modulesEnabled: false })
      .where(eq(schema.projectTable.id, project.id));

    const result = await runImport({
      sprintsAsCycles: true,
      componentsAsModules: true,
    });
    expect(result.created).toBe(4);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        {
          message: "Sprints skipped: cycles are turned off for this project",
          count: 2,
        },
        {
          message:
            "Components skipped: modules are turned off for this project",
          count: 2,
        },
      ]),
    );
    const cycles = await db
      .select()
      .from(schema.cycleTable)
      .where(eq(schema.cycleTable.projectId, project.id));
    expect(cycles).toEqual([]);
  });

  it("maps story points to the active points system", async () => {
    const { project, runImport } = await scene();
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: true })
      .where(eq(schema.projectTable.id, project.id));
    const [estimate] = await db
      .insert(schema.estimateTable)
      .values({
        projectId: project.id,
        name: "Points",
        type: "points",
        isActive: true,
      })
      .returning();
    const [five] = await db
      .insert(schema.estimatePointTable)
      .values({
        estimateId: estimate?.id ?? "",
        value: "5",
        numericValue: 5,
        position: 1,
      })
      .returning();

    await runImport();
    const tasks = await tasksByKey(project.id);
    expect(tasks.get("WEB-1")?.estimatePointId).toBe(five?.id);
  });

  it("uses the status and priority mapping the user chose", async () => {
    const { project, runImport } = await scene();
    await runImport({
      statusMap: { "In Progress": "in-review", Done: "planned" },
      priorityMap: { Highest: "medium" },
    });
    const tasks = await tasksByKey(project.id);
    expect(tasks.get("WEB-1")).toMatchObject({
      status: "in-review",
      priority: "medium",
    });
    expect(tasks.get("WEB-3")).toMatchObject({
      status: "planned",
      columnId: null,
    });
  });

  it("skips comments for members who can't import external authors", async () => {
    const { workspace, project } = await scene();
    const member = await addWorkspaceMember(workspace.id, "member");
    mockAuthenticatedSession(member);
    const { app } = createApp();
    const response = await app.request(
      `/api/jira-import/${project.id}`,
      json("POST", { content: FIXTURE }),
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as ImportResult;
    expect(result.created).toBe(4);
    expect(result.comments).toBe(0);
    expect(result.warnings).toContainEqual({
      message:
        "Comments skipped: importing comment authors needs the Manage workspace settings permission",
      count: 2,
    });
  });

  it("refuses viewers, oversized files and files that aren't Jira exports", async () => {
    const { workspace, project, post } = await scene();

    const tooBig = `Summary\n${"x".repeat(5 * 1024 * 1024)}`;
    expect((await post("", { content: tooBig })).status).toBe(413);
    expect((await post("/preview", { content: tooBig })).status).toBe(413);
    expect((await post("/preview", { content: "Title,Key\nA,1" })).status).toBe(
      400,
    );

    const viewer = await addWorkspaceMember(workspace.id, "viewer");
    mockAuthenticatedSession(viewer);
    const { app } = createApp();
    for (const path of ["", "/preview"]) {
      const response = await app.request(
        `/api/jira-import/${project.id}${path}`,
        json("POST", { content: FIXTURE }),
      );
      expect(response.status).toBe(403);
    }
    const count = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    expect(count).toEqual([]);
  });
});
