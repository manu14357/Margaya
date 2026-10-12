import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { addPerson, removeFromWorkspace } from "./helpers/assignees";
import { day } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  settledActivity,
  taskDetailScene,
} from "./helpers/task-detail";

type CopyJson = {
  task: {
    id: string;
    projectId: string;
    title: string;
    number: number;
    status: string;
    position: number;
    priority: string;
    description: string | null;
    startDate: string | null;
    dueDate: string | null;
    userId: string | null;
    assigneeIds: string[];
    estimatePointId: string | null;
  };
  key: string;
  skipped: string[];
};

recordEvents("task.created", "task.copied", "task-relation.created");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function scene() {
  const s = await taskDetailScene();
  const asMember = s.as(s.member);
  const copy = (taskId: string, body: Record<string, unknown> = {}) =>
    asMember(`/task-copy/${taskId}`, json("POST", body));
  return { ...s, asMember, copy };
}

async function copied(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()) as CopyJson;
}

async function labelsOf(taskId: string) {
  const rows = await db
    .select({ name: schema.labelTable.name, color: schema.labelTable.color })
    .from(schema.labelTable)
    .where(eq(schema.labelTable.taskId, taskId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function customValuesOf(taskId: string) {
  const rows = await db
    .select({
      fieldId: schema.customFieldValueTable.fieldId,
      value: schema.customFieldValueTable.value,
    })
    .from(schema.customFieldValueTable)
    .where(eq(schema.customFieldValueTable.taskId, taskId));
  return rows.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
}

async function parentOf(taskId: string) {
  const [row] = await db
    .select({ sourceTaskId: schema.taskRelationTable.sourceTaskId })
    .from(schema.taskRelationTable)
    .where(
      and(
        eq(schema.taskRelationTable.targetTaskId, taskId),
        eq(schema.taskRelationTable.relationType, "subtask"),
      ),
    );
  return row?.sourceTaskId ?? null;
}

/** A rich source task in the "in-progress" column with a parent. */
async function richSource(s: Awaited<ReturnType<typeof scene>>) {
  const parent = await s.createTask({ title: "Epic-ish parent" });
  await s.createTask({
    status: "in-progress",
    title: "Already there",
    position: 5,
  });
  const source = await s.createTask({
    title: "Ship the report",
    status: "in-progress",
    position: 2,
    priority: "high",
    description: "Write it all down",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    dueDate: new Date("2026-10-10T00:00:00.000Z"),
  });
  await db.insert(schema.taskRelationTable).values({
    sourceTaskId: parent.id,
    targetTaskId: source.id,
    relationType: "subtask",
  });
  await db.insert(schema.labelTable).values([
    {
      name: "bug",
      color: "#f00",
      taskId: source.id,
      workspaceId: s.workspace.id,
    },
    {
      name: "ui",
      color: "#0f0",
      taskId: source.id,
      workspaceId: s.workspace.id,
    },
  ]);
  const [optional, required] = await db
    .insert(schema.customFieldDefinitionTable)
    .values([
      { projectId: s.project.id, name: "Notes", type: "text" },
      { projectId: s.project.id, name: "Team", type: "text", required: true },
    ])
    .returning();
  await db.insert(schema.customFieldValueTable).values([
    { taskId: source.id, fieldId: optional?.id ?? "", value: "remember" },
    { taskId: source.id, fieldId: required?.id ?? "", value: "core" },
  ]);
  return { parent, source, optional, required };
}

describe("make a copy in the same project", () => {
  it("copies the default options into a new task at the end of the column", async () => {
    const s = await scene();
    const { parent, source, optional, required } = await richSource(s);

    const result = await copied(await s.copy(source.id));
    expect(result.skipped).toEqual([]);
    expect(result.key).toBe(`WEB-${result.task.number}`);
    expect(result.task).toMatchObject({
      projectId: s.project.id,
      title: "Ship the report (copy)",
      status: "in-progress",
      priority: "high",
      description: "Write it all down",
      startDate: "2026-10-01T00:00:00.000Z",
      dueDate: "2026-10-10T00:00:00.000Z",
      position: 6,
    });
    expect(result.task.number).toBe(source.number + 1);
    expect(await labelsOf(result.task.id)).toEqual([
      { name: "bug", color: "#f00" },
      { name: "ui", color: "#0f0" },
    ]);
    expect(await customValuesOf(result.task.id)).toEqual(
      [
        { fieldId: optional?.id, value: "remember" },
        { fieldId: required?.id, value: "core" },
      ].sort((a, b) => (a.fieldId ?? "").localeCompare(b.fieldId ?? "")),
    );
    expect(await parentOf(result.task.id)).toBe(parent.id);
    // The source is untouched and keeps its own parent.
    expect(await parentOf(source.id)).toBe(parent.id);
  });

  it("leaves out options that are off, except required field values", async () => {
    const s = await scene();
    const { source, required } = await richSource(s);
    const result = await copied(
      await s.copy(source.id, { title: "  Fresh start  ", include: ["dates"] }),
    );
    expect(result.task).toMatchObject({
      title: "Fresh start",
      description: "",
      startDate: "2026-10-01T00:00:00.000Z",
    });
    expect(await labelsOf(result.task.id)).toEqual([]);
    expect(await parentOf(result.task.id)).toBeNull();
    expect(await customValuesOf(result.task.id)).toEqual([
      { fieldId: required?.id, value: "core" },
    ]);
  });

  it("keeps the assignees in order and drops people who left", async () => {
    const s = await scene();
    const ana = await addPerson(s.workspace.id, "Ana");
    const cy = await addPerson(s.workspace.id, "Cy");
    const source = await s.createTask();
    await assignTask(source.id, [cy.id, ana.id, s.admin.id]);
    await removeFromWorkspace(ana.id, s.workspace.id);

    const result = await copied(await s.copy(source.id));
    expect(result.task.assigneeIds).toEqual([cy.id, s.admin.id]);
    expect(result.task.userId).toBe(cy.id);

    await removeFromWorkspace(cy.id, s.workspace.id);
    await removeFromWorkspace(s.admin.id, s.workspace.id);
    const alone = await copied(await s.copy(source.id));
    expect(alone.task.assigneeIds).toEqual([]);
    expect(alone.skipped).toEqual(["assignees"]);
  });

  it("copies the cycle, modules and estimate when their features are on", async () => {
    const s = await scene();
    const source = await s.createTask();
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: true })
      .where(eq(schema.projectTable.id, s.project.id));
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: s.project.id,
        name: "Sprint",
        startDate: day(-1),
        endDate: day(6),
      })
      .returning();
    const [module] = await db
      .insert(schema.moduleTable)
      .values({ projectId: s.project.id, name: "Billing" })
      .returning();
    const [estimate] = await db
      .insert(schema.estimateTable)
      .values({
        projectId: s.project.id,
        name: "Points",
        type: "points",
        isActive: true,
      })
      .returning();
    const [point] = await db
      .insert(schema.estimatePointTable)
      .values({
        estimateId: estimate?.id ?? "",
        value: "3",
        numericValue: 3,
        position: 1,
      })
      .returning();
    await db
      .insert(schema.cycleTaskTable)
      .values({ taskId: source.id, cycleId: cycle?.id ?? "" });
    await db
      .insert(schema.moduleTaskTable)
      .values({ taskId: source.id, moduleId: module?.id ?? "" });
    await db
      .update(schema.taskTable)
      .set({ estimatePointId: point?.id })
      .where(eq(schema.taskTable.id, source.id));

    const result = await copied(await s.copy(source.id));
    expect(result.skipped).toEqual([]);
    expect(result.task.estimatePointId).toBe(point?.id);
    const [membership] = await db
      .select()
      .from(schema.cycleTaskTable)
      .where(eq(schema.cycleTaskTable.taskId, result.task.id));
    expect(membership?.cycleId).toBe(cycle?.id);
    const modules = await db
      .select()
      .from(schema.moduleTaskTable)
      .where(eq(schema.moduleTaskTable.taskId, result.task.id));
    expect(modules.map((row) => row.moduleId)).toEqual([module?.id]);

    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.project.id));
    const partial = await copied(await s.copy(source.id));
    expect(partial.skipped).toEqual(["planning"]);
  });
});

describe("make a copy in another project", () => {
  it("matches the column by slug, keeps planned tasks planned, and skips project-bound options", async () => {
    const s = await scene();
    const { source } = await richSource(s);
    const { project: ops } = await createProjectFixture({
      workspaceId: s.workspace.id,
      slug: "ops",
    });

    const result = await copied(await s.copy(source.id, { projectId: ops.id }));
    expect(result.task).toMatchObject({
      projectId: ops.id,
      status: "in-progress",
      number: 1,
    });
    expect(result.key).toBe("OPS-1");
    expect(result.skipped).toEqual(["customFields", "parent"]);
    expect(await labelsOf(result.task.id)).toHaveLength(2);
    expect(await customValuesOf(result.task.id)).toEqual([]);
    expect(await parentOf(result.task.id)).toBeNull();

    const planned = await s.createTask({ status: "planned" });
    const plannedCopy = await copied(
      await s.copy(planned.id, { projectId: ops.id }),
    );
    expect(plannedCopy.task.status).toBe("planned");
  });

  it("falls back to the entry column, and applies the target's required fields", async () => {
    const s = await scene();
    const source = await s.createTask({ status: "in-review" });
    const [project] = await db
      .insert(schema.projectTable)
      .values({ workspaceId: s.workspace.id, name: "Flow", slug: "flow" })
      .returning();
    await db.insert(schema.columnTable).values([
      {
        projectId: project?.id ?? "",
        name: "Shipped",
        slug: "shipped",
        position: 0,
        group: "completed",
        isFinal: true,
      },
      {
        projectId: project?.id ?? "",
        name: "Queue",
        slug: "queue",
        position: 1,
        group: "unstarted",
      },
    ]);
    const result = await copied(
      await s.copy(source.id, { projectId: project?.id }),
    );
    expect(result.task.status).toBe("queue");

    await db.insert(schema.customFieldDefinitionTable).values({
      projectId: project?.id ?? "",
      name: "Owner team",
      type: "text",
      required: true,
    });
    const refused = await s.copy(source.id, { projectId: project?.id });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(
      'Custom field "Owner team" is required to create a task.',
    );
  });

  it("refuses archived, foreign and workflow-less destinations", async () => {
    const s = await scene();
    const source = await s.createTask();
    const [archived] = await db
      .insert(schema.projectTable)
      .values({
        workspaceId: s.workspace.id,
        name: "Old",
        slug: "old",
        archivedAt: new Date(),
      })
      .returning();
    const archivedResponse = await s.copy(source.id, {
      projectId: archived?.id,
    });
    expect(archivedResponse.status).toBe(409);
    expect(await archivedResponse.text()).toBe("This project is archived");

    const foreign = await createWorkspaceMember();
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const foreignResponse = await s.copy(source.id, {
      projectId: foreignProject.id,
    });
    expect(foreignResponse.status).toBe(404);
    expect(await foreignResponse.text()).toBe("Project not found");

    const [empty] = await db
      .insert(schema.projectTable)
      .values({ workspaceId: s.workspace.id, name: "Empty", slug: "empty" })
      .returning();
    const emptyResponse = await s.copy(source.id, { projectId: empty?.id });
    expect(emptyResponse.status).toBe(400);
    expect(await emptyResponse.text()).toBe(
      "Destination project does not have a workflow",
    );
  });
});

describe("copy rules", () => {
  it("refuses a task waiting in intake and an empty title", async () => {
    const s = await scene();
    await db.insert(schema.columnTable).values({
      projectId: s.project.id,
      name: "Triage",
      slug: "triage",
      position: -1,
      group: "triage",
    });
    const waiting = await s.createTask({ status: "triage" });
    const response = await s.copy(waiting.id);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "This task is waiting in intake. Accept it before copying it.",
    );

    const task = await s.createTask();
    const untitled = await s.copy(task.id, { title: "   " });
    expect(untitled.status).toBe(400);
    expect(await untitled.text()).toBe("Title is required");

    const unknown = await s.copy(task.id, { include: ["comments"] });
    expect(unknown.status).toBe(400);
  });

  it("needs task:create", async () => {
    const s = await scene();
    const task = await s.createTask();
    expect(
      (await s.as(s.viewer)(`/task-copy/${task.id}`, json("POST", {}))).status,
    ).toBe(403);
    expect(
      (await s.as(s.outsider)(`/task-copy/${task.id}`, json("POST", {})))
        .status,
    ).toBe(403);
  });

  it("copies links when asked, with the caller as their creator", async () => {
    const s = await scene();
    const task = await s.createTask();
    await db.insert(schema.taskLinkTable).values([
      {
        taskId: task.id,
        url: "https://one.example.com/",
        title: "One",
        createdAt: new Date(Date.now() - 1000),
      },
      { taskId: task.id, url: "https://two.example.com/", title: null },
    ]);
    const result = await copied(await s.copy(task.id, { include: ["links"] }));
    const links = (await (
      await s.asMember(`/task-link/${result.task.id}`)
    ).json()) as Array<{
      url: string;
      title: string | null;
      createdBy: { id: string } | null;
    }>;
    expect(links).toEqual([
      expect.objectContaining({
        url: "https://two.example.com/",
        title: null,
        createdBy: expect.objectContaining({ id: s.member.id }),
      }),
      expect.objectContaining({
        url: "https://one.example.com/",
        title: "One",
      }),
    ]);
  });

  it("publishes task.created with its origin, then task.copied, and writes both history rows", async () => {
    const s = await scene();
    const parent = await s.createTask({ title: "Parent" });
    const source = await s.createTask({ title: "Source" });
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: parent.id,
      targetTaskId: source.id,
      relationType: "subtask",
    });

    const result = await copied(
      await s.copy(source.id, { include: ["parent"] }),
    );
    expect(publishedEvents().map((event) => event.name)).toEqual([
      "task.created",
      "task-relation.created",
      "task.copied",
    ]);
    expect(publishedEvents("task.created")[0]?.data).toMatchObject({
      taskId: result.task.id,
      currentUserId: s.member.id,
      type: "created",
      copiedFromTaskId: source.id,
    });
    expect(publishedEvents("task-relation.created")[0]?.data).toMatchObject({
      origin: "copy",
      sourceTaskId: parent.id,
      targetTaskId: result.task.id,
    });
    expect(publishedEvents("task.copied")[0]?.data).toMatchObject({
      taskId: result.task.id,
      projectId: s.project.id,
      sourceTaskId: source.id,
      sourceTaskKey: `WEB-${source.number}`,
      copyTaskKey: result.key,
      included: ["parent"],
      skipped: [],
    });

    const [from] = await settledActivity(result.task.id, "copied_from");
    expect(from?.eventData).toMatchObject({
      sourceTaskId: source.id,
      sourceTaskKey: `WEB-${source.number}`,
      sourceTaskTitle: "Source",
      included: ["parent"],
    });
    const [to] = await settledActivity(source.id, "copied_to");
    expect(to?.eventData).toMatchObject({
      copyTaskId: result.task.id,
      copyTaskKey: result.key,
      copyTaskTitle: "Source (copy)",
    });
    const [added] = await settledActivity(parent.id, "subtask_added");
    expect(added?.eventData).toMatchObject({ otherTaskId: result.task.id });
  });
});

describe("copying files", () => {
  type Command = {
    constructor: { name: string };
    input: { Key: string; CopySource?: string };
  };
  let send: ReturnType<typeof vi.fn>;
  let failingSource: string | null;

  beforeEach(() => {
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.MARGAYA_API_URL = "http://localhost:1337";
    delete process.env.S3_KEY_PREFIX;
    failingSource = null;
    send = vi.fn(async (command: Command) => {
      if (
        command.constructor.name === "CopyObjectCommand" &&
        failingSource &&
        command.input.CopySource === `test-bucket/${failingSource}`
      ) {
        throw new Error("copy failed");
      }
      return {};
    });
    vi.spyOn(S3Client.prototype, "send").mockImplementation(send as never);
  });

  afterEach(() => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  function sent(name: string) {
    return send.mock.calls
      .map(([command]) => command as Command)
      .filter((command) => command.constructor.name === name);
  }

  async function withFiles(s: Awaited<ReturnType<typeof scene>>) {
    const source = await s.createTask({ title: "With files" });
    const other = await s.createTask({ title: "Other" });
    const asset = (
      taskId: string,
      surface: string,
      objectKey: string,
      filename: string,
    ) => ({
      workspaceId: s.workspace.id,
      projectId: s.project.id,
      taskId,
      objectKey,
      filename,
      mimeType: surface === "attachment" ? "application/pdf" : "image/png",
      size: 100,
      kind: surface === "attachment" ? "attachment" : "image",
      surface,
    });
    const [image, foreign, attachment] = await db
      .insert(schema.assetTable)
      .values([
        asset(source.id, "description", "src/desc-image.png", "diagram.png"),
        asset(other.id, "description", "other/image.png", "other.png"),
        asset(source.id, "attachment", "src/file.pdf", "Report.pdf"),
      ])
      .returning();
    const description = `![a](http://localhost:1337/api/asset/${image?.id}) and ![b](http://localhost:1337/api/asset/${foreign?.id})`;
    await db
      .update(schema.taskTable)
      .set({ description })
      .where(eq(schema.taskTable.id, source.id));
    return { source, image, foreign, attachment };
  }

  it("duplicates the source's own images and attachments and rewrites the description", async () => {
    const s = await scene();
    const { source, image, foreign } = await withFiles(s);

    const result = await copied(
      await s.copy(source.id, { include: ["description", "attachments"] }),
    );
    const copies = sent("CopyObjectCommand");
    expect(copies.map((command) => command.input.CopySource).sort()).toEqual([
      "test-bucket/src/desc-image.png",
      "test-bucket/src/file.pdf",
    ]);
    const prefix = `workspace/${s.workspace.id}/project/${s.project.id}/task/${result.task.id}`;
    for (const command of copies) {
      expect(command.input.Key.startsWith(prefix)).toBe(true);
    }

    const rows = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.taskId, result.task.id));
    expect(rows.map((row) => row.surface).sort()).toEqual([
      "attachment",
      "description",
    ]);
    for (const row of rows) {
      expect(row.createdBy).toBe(s.member.id);
      expect(copies.map((command) => command.input.Key)).toContain(
        row.objectKey,
      );
    }
    const newImage = rows.find((row) => row.surface === "description");
    expect(result.task.description).toBe(
      `![a](http://localhost:1337/api/asset/${newImage?.id}) and ![b](http://localhost:1337/api/asset/${foreign?.id})`,
    );
    expect(newImage?.id).not.toBe(image?.id);

    const listed = await s.asMember(`/task-attachment/${result.task.id}`);
    expect(
      ((await listed.json()) as Array<{ filename: string }>).map(
        (a) => a.filename,
      ),
    ).toEqual(["Report.pdf"]);
  });

  it("answers 503 and removes the copied objects when one copy fails", async () => {
    const s = await scene();
    const { source } = await withFiles(s);
    const before = await db.select().from(schema.taskTable);
    failingSource = "src/file.pdf";

    const response = await s.copy(source.id, {
      include: ["description", "attachments"],
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      "Couldn't copy the task's files. Try again, or copy without files.",
    );
    const copiedKeys = sent("CopyObjectCommand")
      .filter(
        (command) => command.input.CopySource !== "test-bucket/src/file.pdf",
      )
      .map((command) => command.input.Key);
    expect(copiedKeys).toHaveLength(1);
    expect(
      sent("DeleteObjectCommand").map((command) => command.input.Key),
    ).toEqual(copiedKeys);
    expect(await db.select().from(schema.taskTable)).toHaveLength(
      before.length,
    );
  });

  it("answers 503 when files exist but storage is not configured", async () => {
    const s = await scene();
    const { source } = await withFiles(s);
    delete process.env.S3_ENDPOINT;
    const response = await s.copy(source.id);
    expect(response.status).toBe(503);

    // Without the files the copy goes through.
    expect((await s.copy(source.id, { include: ["labels"] })).status).toBe(200);
  });

  it("refuses more than 50 description images", async () => {
    const s = await scene();
    const source = await s.createTask();
    const images = await db
      .insert(schema.assetTable)
      .values(
        Array.from({ length: 51 }, (_, index) => ({
          workspaceId: s.workspace.id,
          projectId: s.project.id,
          taskId: source.id,
          objectKey: `src/image-${index}.png`,
          filename: `image-${index}.png`,
          mimeType: "image/png",
          size: 10,
          surface: "description",
        })),
      )
      .returning();
    await db
      .update(schema.taskTable)
      .set({
        description: images.map((image) => `/api/asset/${image.id}`).join(" "),
      })
      .where(eq(schema.taskTable.id, source.id));
    const response = await s.copy(source.id);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("This task has too many images to copy");
  });
});
