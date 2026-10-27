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

// Trello (board JSON), Linear (CSV) and Asana (CSV) imports, each read from a
// small anonymised export in ./fixtures.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(resolve(here, "fixtures", name), "utf8");
const TRELLO = fixture("trello-board.json");
const LINEAR = fixture("linear-export.csv");
const ASANA = fixture("asana-export.csv");

type Source = "trello" | "linear" | "asana";

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

beforeEach(async () => {
  await resetTestDatabase();
});

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
  const post = (source: Source, path: string, body: unknown) =>
    app.request(
      `/api/external-import/${source}/${project.id}${path}`,
      json("POST", body),
    );
  const runImport = async (
    source: Source,
    content: string,
    options: Record<string, unknown> = {},
  ) => {
    const response = await post(source, "", {
      content,
      timeZone: "UTC",
      options,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ImportResult;
  };
  return { user, workspace, project, columns, ben, app, post, runImport };
}

async function tasksByKey(projectId: string, source: Source) {
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
        eq(schema.activityTable.externalSource, source),
      ),
    );
  return new Map(rows.map((row) => [row.key ?? "", row.task]));
}

async function labelNames(taskId: string) {
  const rows = await db
    .select({ name: schema.labelTable.name })
    .from(schema.labelTable)
    .where(eq(schema.labelTable.taskId, taskId))
    .orderBy(asc(schema.labelTable.name));
  return rows.map((row) => row.name);
}

async function assigneeIds(taskId: string) {
  const rows = await db
    .select({ userId: schema.taskAssigneeTable.userId })
    .from(schema.taskAssigneeTable)
    .where(eq(schema.taskAssigneeTable.taskId, taskId));
  return rows.map((row) => row.userId);
}

async function relationsOf(taskIds: string[]) {
  const rows = await db
    .select({
      sourceTaskId: schema.taskRelationTable.sourceTaskId,
      targetTaskId: schema.taskRelationTable.targetTaskId,
      relationType: schema.taskRelationTable.relationType,
    })
    .from(schema.taskRelationTable)
    .where(inArray(schema.taskRelationTable.sourceTaskId, taskIds));
  return rows;
}

describe("Trello import", () => {
  it("previews lists, people and contents without exposing member emails", async () => {
    const s = await scene();
    const response = await s.post("trello", "/preview", { content: TRELLO });
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview.itemCount).toBe(3);
    expect(preview.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "To Do", suggestedStatus: "to-do" }),
        expect.objectContaining({
          name: "Doing",
          suggestedStatus: "in-progress",
        }),
        expect.objectContaining({ name: "Done", suggestedStatus: "done" }),
      ]),
    );
    expect(preview.people).toEqual(
      expect.arrayContaining([
        {
          name: "Ben Builder",
          count: 1,
          member: { id: s.ben.id, name: "Ben Builder" },
        },
        { name: "Casey Unknown", count: 1, member: null },
      ]),
    );
    expect(JSON.stringify(preview)).not.toContain("ben@example.test");
    expect(preview.totals).toMatchObject({
      comments: 2,
      checklists: 1,
      alreadyImported: 0,
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        { message: "Archived cards and lists aren't imported", count: 2 },
      ]),
    );
  });

  it("imports cards with lists, labels, members, dates, checklists and comments", async () => {
    const s = await scene();
    const result = await s.runImport("trello", TRELLO);
    expect(result).toMatchObject({
      total: 3,
      created: 3,
      failed: 0,
      comments: 2,
      unmatchedPeople: ["Casey Unknown"],
    });

    const tasks = await tasksByKey(s.project.id, "trello");
    const login = tasks.get("AbC12345");
    expect(login).toMatchObject({
      title: "Fix login redirect",
      status: "to-do",
      dueDate: new Date("2024-02-01T17:00:00.000Z"),
      startDate: new Date("2024-01-20T09:00:00.000Z"),
      createdAt: new Date(0x65a0f000 * 1000),
    });
    expect(login?.description).toContain("Users land on **home**");
    expect(login?.description).toContain(
      "**Steps**\n\n- [ ] Patch the callback\n- [x] Reproduce",
    );
    expect(await labelNames(login!.id)).toEqual(["Bug", "green"]);
    expect(await assigneeIds(login!.id)).toEqual([s.ben.id]);

    const notes = tasks.get("DeF67890");
    expect(notes?.status).toBe("in-progress");
    expect(await assigneeIds(notes!.id)).toEqual([]);
    expect(notes?.description).toBe(
      "_Assigned in Trello to Casey Unknown (no matching workspace member)._",
    );

    const shipped = tasks.get("GhI13579");
    expect(shipped?.status).toBe("done");
    expect(shipped?.completedAt).not.toBeNull();

    const comments = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, login!.id),
          eq(schema.activityTable.type, "comment"),
        ),
      );
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      content: "Looks like a cookie issue.",
      externalUserName: "Ben Builder",
      externalSource: "trello",
      createdAt: new Date("2024-01-22T11:00:00.000Z"),
    });
    expect(result.warnings.map((w) => w.message)).toContain(
      'Unreadable dates are skipped (e.g. due "not a date")',
    );
  });

  it("skips cards imported before, or updates them without duplicating comments", async () => {
    const s = await scene();
    await s.runImport("trello", TRELLO);
    const again = await s.runImport("trello", TRELLO);
    expect(again).toMatchObject({ created: 0, skipped: 3, comments: 0 });

    const edited = TRELLO.replace(
      "Fix login redirect",
      "Fix the login redirect",
    );
    const updated = await s.runImport("trello", edited, { mode: "update" });
    expect(updated).toMatchObject({ created: 0, updated: 3, comments: 0 });
    const tasks = await tasksByKey(s.project.id, "trello");
    expect(tasks.size).toBe(3);
    expect(tasks.get("AbC12345")?.title).toBe("Fix the login redirect");
  });

  it("refuses files that aren't Trello board exports", async () => {
    const s = await scene();
    const notJson = await s.post("trello", "/preview", { content: "nope" });
    expect(notJson.status).toBe(400);
    expect(await notJson.text()).toBe("This file can't be read as JSON");
    const wrong = await s.post("trello", "/preview", {
      content: JSON.stringify({ issues: [] }),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toMatch(/^This isn't a Trello board export/);
    const linearFile = await s.post("trello", "/preview", { content: LINEAR });
    expect(linearFile.status).toBe(400);
  });
});

describe("Linear import", () => {
  it("imports issues with statuses, priorities, labels, people, dates and relations", async () => {
    const s = await scene();
    const preview = await (
      await s.post("linear", "/preview", { content: LINEAR, timeZone: "UTC" })
    ).json();
    expect(preview.itemCount).toBe(4);
    expect(preview.totals).toMatchObject({ subtasks: 1, links: 2 });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        { message: "Archived issues aren't imported", count: 1 },
      ]),
    );

    const result = await s.runImport("linear", LINEAR);
    expect(result).toMatchObject({
      total: 4,
      created: 4,
      failed: 0,
      relations: 3,
      unmatchedPeople: ["Casey Unknown"],
    });

    const tasks = await tasksByKey(s.project.id, "linear");
    const ci = tasks.get("ENG-1");
    expect(ci).toMatchObject({
      title: "Set up CI",
      status: "to-do",
      priority: "high",
      createdAt: new Date("2024-01-10T09:00:00.000Z"),
      dueDate: new Date("2024-02-15T00:00:00.000Z"),
      createdBy: s.ben.id,
    });
    expect(ci?.description).toBe(
      "Run tests on **every** push.\nCache the dependencies.",
    );
    expect(await labelNames(ci!.id)).toEqual(["CI", "Infra"]);
    expect(await assigneeIds(ci!.id)).toEqual([s.ben.id]);

    expect(tasks.get("ENG-2")).toMatchObject({
      status: "in-progress",
      priority: "medium",
      startDate: new Date("2024-01-12T10:00:00.000Z"),
    });
    expect(tasks.get("ENG-3")).toMatchObject({
      status: "done",
      priority: "urgent",
    });
    expect(tasks.get("ENG-4")).toMatchObject({
      status: "done",
      priority: "no-priority",
    });

    const id = (key: string) => tasks.get(key)!.id;
    const relations = await relationsOf([...tasks.values()].map((t) => t.id));
    expect(relations).toEqual(
      expect.arrayContaining([
        {
          sourceTaskId: id("ENG-1"),
          targetTaskId: id("ENG-2"),
          relationType: "subtask",
        },
        {
          sourceTaskId: id("ENG-3"),
          targetTaskId: id("ENG-2"),
          relationType: "blocks",
        },
        expect.objectContaining({ relationType: "related" }),
      ]),
    );
  });

  it("refuses a CSV from another tool", async () => {
    const s = await scene();
    const response = await s.post("linear", "/preview", { content: ASANA });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "This isn't a Linear CSV export: it needs the ID, Title and Status columns",
    );
  });
});

describe("Asana import", () => {
  it("imports tasks with sections, tags, assignee emails, dates and sub-tasks", async () => {
    const s = await scene();
    const result = await s.runImport("asana", ASANA);
    expect(result).toMatchObject({
      total: 4,
      created: 4,
      failed: 0,
      relations: 4,
      unmatchedPeople: ["dana@elsewhere.test"],
    });

    const tasks = await tasksByKey(s.project.id, "asana");
    const plan = tasks.get("1200000000000001");
    expect(plan).toMatchObject({
      title: "Plan the launch",
      status: "to-do",
      priority: "high",
      description: "Draft the launch plan.",
      startDate: new Date("2024-01-10T00:00:00.000Z"),
      dueDate: new Date("2024-01-31T00:00:00.000Z"),
    });
    expect(await labelNames(plan!.id)).toEqual(["Marketing", "Q1"]);
    expect(await assigneeIds(plan!.id)).toEqual([s.ben.id]);

    const venue = tasks.get("1200000000000002");
    expect(venue).toMatchObject({ status: "in-progress", priority: "low" });
    expect(venue?.description).toBe(
      "_Assigned in Asana to dana@elsewhere.test (no matching workspace member)._",
    );
    expect(tasks.get("1200000000000003")?.status).toBe("done");
    expect(tasks.get("1200000000000004")?.status).toBe("planned");

    const id = (key: string) => tasks.get(key)!.id;
    const relations = await relationsOf([...tasks.values()].map((t) => t.id));
    expect(relations).toEqual(
      expect.arrayContaining([
        {
          sourceTaskId: id("1200000000000001"),
          targetTaskId: id("1200000000000002"),
          relationType: "subtask",
        },
        {
          sourceTaskId: id("1200000000000001"),
          targetTaskId: id("1200000000000003"),
          relationType: "subtask",
        },
        {
          sourceTaskId: id("1200000000000003"),
          targetTaskId: id("1200000000000002"),
          relationType: "blocks",
        },
        {
          sourceTaskId: id("1200000000000002"),
          targetTaskId: id("1200000000000004"),
          relationType: "blocks",
        },
      ]),
    );
  });
});

describe("limits and permissions", () => {
  it("answers 413 for files over the source's limit", async () => {
    const s = await scene();
    const big = `${LINEAR}${" ".repeat(5 * 1024 * 1024)}`;
    const response = await s.post("linear", "/preview", { content: big });
    expect(response.status).toBe(413);
  });

  it("keeps imports inside the workspace and behind task:create", async () => {
    const s = await scene();
    const outsider = await createWorkspaceMember({ userName: "Oz" });
    mockAuthenticatedSession(outsider.user);
    const foreign = await s.post("asana", "", { content: ASANA });
    expect(foreign.status).toBe(403);

    const viewer = await addWorkspaceMember(s.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);
    const denied = await s.post("asana", "/preview", { content: ASANA });
    expect(denied.status).toBe(403);
    expect(await tasksByKey(s.project.id, "asana")).toEqual(new Map());
  });

  it("refuses an unknown source", async () => {
    const s = await scene();
    const unknown = await s.app.request(
      `/api/external-import/monday/${s.project.id}/preview`,
      json("POST", { content: ASANA }),
    );
    expect(unknown.status).toBe(400);
  });
});
