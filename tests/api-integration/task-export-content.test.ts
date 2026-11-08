import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { FIXED_HEADERS } from "../../apps/api/src/task-export/columns";
import {
  startExportRunner,
  stopExportRunner,
} from "../../apps/api/src/task-export/runner";
import { readZip, zipTexts } from "../api/task-export/helpers/read-zip";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { exportScene, parseCsv } from "./helpers/task-exports";

beforeEach(async () => {
  stopExportRunner();
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  await resetTestDatabase();
});

afterAll(() => {
  startExportRunner();
});

/**
 * web: WEB-1 (parent), WEB-2 (rich: two assignees, label, subscriber,
 * cycle, module, estimate, link, attachment, comment, time, custom fields,
 * blocks WEB-1), WEB-3 (archived, backlog) and a triage request.
 * api: API-1 with a cycle while cycles and time tracking are off there.
 */
async function richScene() {
  const s = await exportScene();
  const web = s.web.project.id;
  const api = s.api.project.id;
  const { points } = await s.insertEstimate(web);
  const cycle = await s.insertCycle({ name: "Sprint 3" });
  const module = await s.insertModule({ name: "Auth" });
  const apiCycle = await s.insertCycle({ projectId: api, name: "API sprint" });
  await db
    .update(schema.projectTable)
    .set({ cyclesEnabled: false, timeTrackingEnabled: false })
    .where(eq(schema.projectTable.id, api));

  const severity = await s.insertField({
    name: "Severity",
    type: "number",
    options: null,
    position: 0,
  });
  const customer = await s.insertField({
    name: "Customer",
    type: "text",
    options: null,
    position: 1,
  });
  const apiSeverity = await s.insertField({
    projectId: api,
    name: "Severity",
    type: "dropdown",
    options: ["High", "Low"],
    position: 0,
  });
  const team = await s.insertField({
    projectId: api,
    name: "Team",
    type: "text",
    options: null,
    position: 1,
  });

  const parent = await s.createTask({ title: "Parent" });
  const rich = await s.createTask({
    title: "=SUM(1)",
    description: "Steps:\n1. Log in",
    priority: "high",
    createdBy: s.mia.id,
    dueDate: new Date("2026-10-01T00:00:00Z"),
    estimatePointId: points[1]?.id,
  });
  const archived = await s.createTask({
    title: "Old idea",
    status: "planned",
    archivedAt: new Date("2026-09-01T00:00:00Z"),
  });
  await db.insert(schema.columnTable).values({
    projectId: web,
    name: "Triage",
    slug: "triage",
    group: "triage",
    position: 99,
  });
  await s.createTask({ title: "Waiting in intake", status: "triage" });
  const apiTask = await s.createTask({ projectId: api, title: "API task" });

  await db.insert(schema.taskAssigneeTable).values([
    { taskId: rich.id, userId: s.ada.id, position: 0 },
    { taskId: rich.id, userId: s.mia.id, position: 1 },
  ]);
  await db.insert(schema.labelTable).values([
    { workspaceId: s.workspaceId, name: "bug", color: "#00ff00" },
    {
      workspaceId: s.workspaceId,
      taskId: rich.id,
      name: "bug",
      color: "#ff0000",
    },
  ]);
  await db.insert(schema.taskSubscriberTable).values([
    { taskId: rich.id, userId: s.owner.id, subscribed: true },
    { taskId: rich.id, userId: s.vic.id, subscribed: false },
  ]);
  await db.insert(schema.cycleTaskTable).values([
    { taskId: rich.id, cycleId: cycle.id },
    { taskId: apiTask.id, cycleId: apiCycle.id },
  ]);
  await db
    .insert(schema.moduleTaskTable)
    .values({ moduleId: module.id, taskId: rich.id });
  await db.insert(schema.taskRelationTable).values([
    { sourceTaskId: parent.id, targetTaskId: rich.id, relationType: "subtask" },
    { sourceTaskId: rich.id, targetTaskId: parent.id, relationType: "blocks" },
  ]);
  await db.insert(schema.taskLinkTable).values({
    taskId: rich.id,
    url: "https://example.com/spec",
    title: "Spec",
  });
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({ projectId: web, type: "github", config: "{}" })
    .returning();
  await db.insert(schema.externalLinkTable).values({
    taskId: rich.id,
    integrationId: integration?.id ?? "",
    resourceType: "pull_request",
    externalId: "4",
    url: "https://code.example.com/pr/4",
    title: "PR #4",
  });
  await db.insert(schema.assetTable).values({
    workspaceId: s.workspaceId,
    projectId: web,
    taskId: rich.id,
    objectKey: `objects/${rich.id}/a.pdf`,
    filename: "a.pdf",
    mimeType: "application/pdf",
    size: 10,
    kind: "file",
    surface: "attachment",
  });
  await db.insert(schema.activityTable).values({
    taskId: rich.id,
    type: "comment",
    userId: s.mia.id,
    content: "Looks good",
  });
  const start = new Date("2026-09-20T08:00:00Z");
  await db.insert(schema.timeEntryTable).values([
    { taskId: rich.id, startTime: start, duration: 5400 },
    { taskId: rich.id, startTime: start, duration: 1800 },
    { taskId: apiTask.id, startTime: start, duration: 600 },
  ]);
  await db.insert(schema.customFieldValueTable).values([
    { taskId: rich.id, fieldId: severity.id, value: "3" },
    { taskId: rich.id, fieldId: customer.id, value: "Acme" },
    { taskId: apiTask.id, fieldId: apiSeverity.id, value: "High" },
    { taskId: apiTask.id, fieldId: team.id, value: "Core" },
  ]);

  return { ...s, parent, rich, archived, apiTask, cycle, module };
}

describe("CSV export", () => {
  it("writes every column, guarded and quoted, in project and number order", async () => {
    const s = await richScene();
    const row = await s.runExport(s.mia, { format: "csv" });
    expect(row.status).toBe("completed");
    expect(row.taskCount).toBe(4);

    const raw = (await s.download(s.mia, row.id)).toString("utf8");
    expect(raw.startsWith("﻿")).toBe(true);
    expect(raw.endsWith("\r\n")).toBe(true);
    for (const line of raw.slice(1).split("\r\n").slice(0, 2)) {
      expect(line.startsWith('"')).toBe(true);
    }
    const [header, ...rows] = parseCsv(raw.slice(1));
    expect(header).toEqual([
      ...FIXED_HEADERS,
      "Custom: Severity",
      "Custom: Customer",
      "Custom: Team",
    ]);
    const column = (name: string) => header?.indexOf(name) ?? -1;
    expect(rows.map((cells) => cells[column("Key")])).toEqual([
      "WEB-1",
      "WEB-2",
      "WEB-3",
      "API-1",
    ]);

    const rich = rows[1] ?? [];
    const cell = (name: string) => rich[column(name)];
    expect(cell("Project")).toBe("Integration Project");
    expect(cell("Number")).toBe("2");
    expect(cell("Parent")).toBe("WEB-1");
    expect(cell("Title")).toBe("'=SUM(1)");
    expect(cell("Description")).toBe("Steps:\n1. Log in");
    expect(cell("Status")).toBe("To Do");
    expect(cell("Status group")).toBe("unstarted");
    expect(cell("Priority")).toBe("high");
    expect(cell("Assignees")).toBe("Ada, Mia");
    expect(cell("Assignee emails")).toBe(`${s.ada.email}, ${s.mia.email}`);
    expect(cell("Subscribers")).toBe("Owen");
    expect(cell("Created by")).toBe("Mia");
    expect(cell("Due date")).toBe("2026-10-01T00:00:00.000Z");
    expect(cell("Archived at")).toBe("");
    expect(cell("Estimate")).toBe("2");
    expect(cell("Labels")).toBe("bug");
    expect(cell("Cycle")).toBe("Sprint 3");
    expect(cell("Modules")).toBe("Auth");
    expect(JSON.parse(cell("Links") ?? "")).toEqual([
      { title: "Spec", url: "https://example.com/spec" },
      { title: "PR #4", url: "https://code.example.com/pr/4" },
    ]);
    expect(JSON.parse(cell("Relations") ?? "")).toEqual([
      { type: "blocks", task: "WEB-1", direction: "outgoing" },
    ]);
    expect(JSON.parse(cell("Comments") ?? "")).toEqual([
      { author: "Mia", createdAt: expect.any(String), text: "Looks good" },
    ]);
    expect(cell("Sub-tasks")).toBe("0");
    expect(cell("Link count")).toBe("2");
    expect(cell("Attachment count")).toBe("1");
    expect(cell("Time logged (minutes)")).toBe("120");
    expect(cell("Custom: Severity")).toBe("3");
    expect(cell("Custom: Customer")).toBe("Acme");
    expect(cell("Custom: Team")).toBe("");

    const parent = rows[0] ?? [];
    expect(parent[column("Sub-tasks")]).toBe("1");
    expect(JSON.parse(parent[column("Relations")] ?? "")).toEqual([
      { type: "blocks", task: "WEB-2", direction: "incoming" },
    ]);

    const archived = rows[2] ?? [];
    expect(archived[column("Status")]).toBe("Backlog");
    expect(archived[column("Status group")]).toBe("backlog");
    expect(archived[column("Archived at")]).toBe("2026-09-01T00:00:00.000Z");

    // Cycles and time tracking are off in api: those cells stay empty.
    const apiRow = rows[3] ?? [];
    expect(apiRow[column("Cycle")]).toBe("");
    expect(apiRow[column("Time logged (minutes)")]).toBe("");
    expect(apiRow[column("Custom: Severity")]).toBe("High");
    expect(apiRow[column("Custom: Team")]).toBe("Core");
  });

  it("leaves out archived tasks on request and triage requests always", async () => {
    const s = await richScene();
    const row = await s.runExport(s.mia, {
      format: "csv",
      projectIds: [s.web.project.id],
      includeArchived: false,
    });
    const [header, ...rows] = parseCsv(
      (await s.download(s.mia, row.id)).toString("utf8").slice(1),
    );
    const key = header?.indexOf("Key") ?? -1;
    expect(rows.map((cells) => cells[key])).toEqual(["WEB-1", "WEB-2"]);
    expect(row.taskCount).toBe(2);
    // One project: its own custom fields only.
    expect(header?.slice(FIXED_HEADERS.length)).toEqual([
      "Custom: Severity",
      "Custom: Customer",
    ]);
  });

  it("writes a header even without tasks", async () => {
    const s = await exportScene();
    const row = await s.runExport(s.mia, { format: "csv" });
    const rows = parseCsv(
      (await s.download(s.mia, row.id)).toString("utf8").slice(1),
    );
    expect(rows).toHaveLength(1);
    expect(row.taskCount).toBe(0);
  });

  it("zips one CSV per project when split", async () => {
    const s = await richScene();
    const row = await s.runExport(s.mia, {
      format: "csv",
      splitByProject: true,
    });
    const date = new Date().toISOString().slice(0, 10);
    expect(row.fileName).toBe(`${s.workspace.slug}-tasks-${date}.zip`);
    expect(row.contentType).toBe("application/zip");
    const files = zipTexts(await s.download(s.mia, row.id));
    expect([...files.keys()]).toEqual(["web-tasks.csv", "api-tasks.csv"]);
    const apiRows = parseCsv(files.get("api-tasks.csv")?.slice(1) ?? "");
    expect(apiRows[0]?.slice(FIXED_HEADERS.length)).toEqual([
      "Custom: Severity",
      "Custom: Team",
    ]);
    expect(apiRows).toHaveLength(2);
  });
});

describe("JSON export", () => {
  it("writes the v1 document with nested values", async () => {
    const s = await richScene();
    const row = await s.runExport(s.ada, { format: "json" });
    expect(row.contentType).toBe("application/json");
    const document = JSON.parse(
      (await s.download(s.ada, row.id)).toString("utf8"),
    );
    expect(document).toMatchObject({
      schema: "margaya.task-export.v1",
      workspace: {
        id: s.workspaceId,
        name: s.workspace.name,
        slug: s.workspace.slug,
      },
      projects: [
        { id: s.web.project.id, slug: "web" },
        { id: s.api.project.id, slug: "api" },
      ],
      options: { includeArchived: true },
    });
    expect(Number.isNaN(Date.parse(document.exportedAt))).toBe(false);
    expect(document.tasks).toHaveLength(4);
    const rich = document.tasks[1];
    expect(rich).toMatchObject({
      id: s.rich.id,
      project: { id: s.web.project.id, slug: "web" },
      key: "WEB-2",
      number: 2,
      parent: { id: s.parent.id, key: "WEB-1" },
      title: "=SUM(1)",
      status: { slug: "to-do", name: "To Do" },
      group: "unstarted",
      assignees: [
        { id: s.ada.id, name: "Ada", email: s.ada.email },
        { id: s.mia.id, name: "Mia", email: s.mia.email },
      ],
      subscribers: [{ id: s.owner.id, name: "Owen" }],
      createdBy: { id: s.mia.id, name: "Mia" },
      estimate: { value: "2", type: "points" },
      labels: [{ name: "bug", color: "#00ff00" }],
      cycle: { id: s.cycle.id, name: "Sprint 3" },
      modules: [{ id: s.module.id, name: "Auth" }],
      relations: [{ type: "blocks", task: "WEB-1", direction: "outgoing" }],
      timeLoggedMinutes: 120,
      customFields: [
        { name: "Severity", type: "number", value: "3" },
        { name: "Customer", type: "text", value: "Acme" },
      ],
    });
    expect(rich.commentsTruncated).toBeUndefined();
    expect(document.tasks[3]).toMatchObject({
      key: "API-1",
      cycle: null,
      timeLoggedMinutes: null,
    });
  });

  it("leaves out relations whose other task the requester can't reach", async () => {
    const s = await exportScene();
    const { project: secret } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "secret",
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, secret.id));
    const hidden = await s.createTask({
      projectId: secret.id,
      title: "Hidden",
    });
    const foreign = await createWorkspaceMember();
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
      slug: "foreign",
    });
    const foreignTask = await s.createTask({
      projectId: foreignProject.id,
      title: "Foreign",
    });
    const seen = await s.createTask({
      projectId: s.api.project.id,
      title: "Seen",
    });
    const waiting = await s.createTask({ title: "Waiting" });
    const child = await s.createTask({ title: "Legacy child" });
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: hidden.id,
        targetTaskId: waiting.id,
        relationType: "blocks",
      },
      {
        sourceTaskId: waiting.id,
        targetTaskId: foreignTask.id,
        relationType: "related",
      },
      {
        sourceTaskId: seen.id,
        targetTaskId: waiting.id,
        relationType: "blocks",
      },
      // Legacy rows: a parent in another project, or another workspace.
      {
        sourceTaskId: hidden.id,
        targetTaskId: child.id,
        relationType: "subtask",
      },
    ]);

    const exported = async (user: typeof s.mia, format: "json" | "csv") => {
      const row = await s.runExport(user, {
        format,
        projectIds: [s.web.project.id],
      });
      expect(row.error ?? null).toBeNull();
      return (await s.download(user, row.id)).toString("utf8");
    };
    type Row = {
      key: string;
      parent: { key: string } | null;
      relations: { task: string; direction: string }[];
    };
    const tasksOf = (text: string) =>
      new Map(
        (JSON.parse(text) as { tasks: Row[] }).tasks.map((task) => [
          task.key,
          task,
        ]),
      );
    const related = (task: Row | undefined) =>
      task?.relations.map((relation) => relation.task).sort();

    // A member outside the restricted project.
    const forMember = await exported(s.mia, "json");
    expect(forMember).not.toContain("SECRET-");
    expect(forMember).not.toContain("FOREIGN-");
    const memberTasks = tasksOf(forMember);
    expect(related(memberTasks.get(`WEB-${waiting.number}`))).toEqual([
      "API-1",
    ]);
    expect(memberTasks.get(`WEB-${child.number}`)?.parent).toBeNull();
    const csv = await exported(s.mia, "csv");
    expect(csv).not.toContain("SECRET-");
    expect(csv).not.toContain("FOREIGN-");

    // An owner reaches the restricted project; no one reaches the other workspace.
    const forOwner = await exported(s.owner, "json");
    expect(forOwner).not.toContain("FOREIGN-");
    const ownerTasks = tasksOf(forOwner);
    expect(related(ownerTasks.get(`WEB-${waiting.number}`))).toEqual([
      "API-1",
      "SECRET-1",
    ]);
    expect(ownerTasks.get(`WEB-${child.number}`)?.parent?.key).toBe("SECRET-1");
  });

  it("keeps the newest 200 comments and flags the rest", async () => {
    const s = await exportScene();
    const task = await s.createTask({ title: "Chatty" });
    const base = Date.parse("2026-09-01T00:00:00Z");
    await db.insert(schema.activityTable).values(
      Array.from({ length: 201 }, (_, index) => ({
        taskId: task.id,
        type: "comment",
        userId: s.mia.id,
        content: `comment ${index}`,
        createdAt: new Date(base + index * 60_000),
      })),
    );
    const row = await s.runExport(s.mia, { format: "json" });
    const [exported] = JSON.parse(
      (await s.download(s.mia, row.id)).toString("utf8"),
    ).tasks;
    expect(exported.comments).toHaveLength(200);
    expect(exported.comments[0].text).toBe("comment 200");
    expect(exported.comments[199].text).toBe("comment 1");
    expect(exported.commentsTruncated).toBe(true);
  });
});

describe("XLSX export", () => {
  it("writes a workbook with typed, escaped and truncated cells", async () => {
    const s = await exportScene();
    const bell = String.fromCharCode(7);
    await s.createTask({
      title: `<b>Tom & Jerry</b>${bell}`,
      description: "d".repeat(40_000),
    });
    const row = await s.runExport(s.mia, {
      format: "xlsx",
      projectIds: [s.web.project.id],
    });
    const date = new Date().toISOString().slice(0, 10);
    expect(row.fileName).toBe(`web-tasks-${date}.xlsx`);
    expect(row.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const parts = zipTexts(await s.download(s.mia, row.id));
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(parts.has(part), part).toBe(true);
    }
    expect(parts.get("xl/workbook.xml")).toContain('<sheet name="Tasks"');
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain(
      '<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Project</t></is></c>',
    );
    // Number is the third column, written as a number.
    expect(sheet).toContain('<c r="C2"><v>1</v></c>');
    expect(sheet).toContain("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;</t>");
    expect(sheet).not.toContain(bell);
    expect(sheet).toContain(`${"d".repeat(32_750)}…[truncated]</t>`);
    expect(sheet).not.toContain("d".repeat(32_751));
  });

  it("puts each project on its own uniquely named sheet when split", async () => {
    const s = await exportScene();
    await db
      .update(schema.projectTable)
      .set({ name: "Web: App" })
      .where(eq(schema.projectTable.id, s.web.project.id));
    await db
      .update(schema.projectTable)
      .set({ name: "Web/ App" })
      .where(eq(schema.projectTable.id, s.api.project.id));
    await s.createTask({ title: "One" });
    await s.createTask({ projectId: s.api.project.id, title: "Two" });
    const row = await s.runExport(s.mia, {
      format: "xlsx",
      splitByProject: true,
    });
    expect(row.fileName?.endsWith(".xlsx")).toBe(true);
    const archive = await s.download(s.mia, row.id);
    const parts = zipTexts(archive);
    const workbook = parts.get("xl/workbook.xml") ?? "";
    expect(workbook).toContain('<sheet name="Web  App" sheetId="1"');
    expect(workbook).toContain('<sheet name="Web  App (2)" sheetId="2"');
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain(">One</t>");
    expect(parts.get("xl/worksheets/sheet2.xml")).toContain(">Two</t>");
    expect(readZip(archive)).toHaveLength(7);
  });
});
