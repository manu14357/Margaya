import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  activityRows,
  json,
  settledActivity,
  taskDetailScene,
} from "./helpers/task-detail";

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

async function scene() {
  const s = await taskDetailScene();
  return { ...s, asMember: s.as(s.member), asAdmin: s.as(s.admin) };
}

/** The full update body for a task, with some fields replaced. */
function fullUpdate(
  task: typeof schema.taskTable.$inferSelect,
  changes: Record<string, unknown>,
) {
  return json("PUT", {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    position: task.position ?? 0,
    startDate: task.startDate?.toISOString(),
    dueDate: task.dueDate?.toISOString(),
    ...changes,
  });
}

/** Lets background subscribers finish, then asserts nothing else arrived. */
async function quiet() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe("start date, due date and description through the full update", () => {
  it("records start date changes, and nothing for an unchanged date", async () => {
    const { asMember, createTask, member } = await scene();
    const task = await createTask({
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });

    expect(
      (await asMember(`/task/${task.id}`, fullUpdate(task, {}))).status,
    ).toBe(200);
    await quiet();
    expect(await activityRows(task.id, "start_date_changed")).toEqual([]);

    const changed = await asMember(
      `/task/${task.id}`,
      fullUpdate(task, { startDate: "2026-10-05T00:00:00.000Z" }),
    );
    expect(changed.status).toBe(200);
    const [row] = await settledActivity(task.id, "start_date_changed");
    expect(row).toMatchObject({
      userId: member.id,
      eventData: {
        oldStartDate: "2026-10-01T00:00:00.000Z",
        newStartDate: "2026-10-05T00:00:00.000Z",
      },
    });

    const cleared = {
      ...task,
      startDate: new Date("2026-10-05T00:00:00.000Z"),
    };
    await asMember(
      `/task/${task.id}`,
      fullUpdate(cleared, { startDate: undefined }),
    );
    const rows = await settledActivity(task.id, "start_date_changed", 2);
    expect(rows[1]?.eventData).toEqual({
      oldStartDate: "2026-10-05T00:00:00.000Z",
      newStartDate: null,
    });
  });

  it("audits due date and description edits and resets sent reminders", async () => {
    const { asMember, createTask } = await scene();
    const task = await createTask({
      dueDate: new Date("2026-10-01T00:00:00.000Z"),
      description: "old text",
    });
    await db
      .insert(schema.taskReminderSentTable)
      .values({ taskId: task.id, reminderType: "due_soon" });

    await asMember(
      `/task/${task.id}`,
      fullUpdate(task, {
        dueDate: "2026-10-09T00:00:00.000Z",
        description: "new text",
      }),
    );
    const [due] = await settledActivity(task.id, "due_date_changed");
    expect(due?.eventData).toEqual({
      oldDueDate: "2026-10-01T00:00:00.000Z",
      newDueDate: "2026-10-09T00:00:00.000Z",
    });
    const [description] = await settledActivity(task.id, "description_changed");
    expect(description?.eventData).toEqual({});
    expect(
      await db
        .select()
        .from(schema.taskReminderSentTable)
        .where(eq(schema.taskReminderSentTable.taskId, task.id)),
    ).toEqual([]);
  });
});

describe("labels", () => {
  it("records single and bulk label changes by name", async () => {
    const { asMember, createTask, workspace, member } = await scene();
    const task = await createTask();
    const other = await createTask();
    const [label] = await db
      .insert(schema.labelTable)
      .values({ name: "bug", color: "#f00", workspaceId: workspace.id })
      .returning();

    const attached = await asMember(
      `/label/${label?.id}/task`,
      json("PUT", { taskId: task.id }),
    );
    expect(attached.status).toBe(200);
    const taskLabel = (await attached.json()) as { id: string };
    const [added] = await settledActivity(task.id, "label_added");
    expect(added).toMatchObject({
      userId: member.id,
      eventData: { name: "bug", color: "#f00" },
    });

    await asMember(`/label/${taskLabel.id}/task`, { method: "DELETE" });
    const [removed] = await settledActivity(task.id, "label_removed");
    expect(removed?.eventData).toEqual({ name: "bug", color: "#f00" });

    await asMember(
      "/task/bulk",
      json("PATCH", {
        taskIds: [other.id],
        operation: "addLabel",
        value: label?.id,
      }),
    );
    const [bulkAdded] = await settledActivity(other.id, "label_added");
    expect(bulkAdded?.eventData).toEqual({ name: "bug", color: "#f00" });

    await asMember(
      "/task/bulk",
      json("PATCH", {
        taskIds: [other.id],
        operation: "removeLabel",
        value: label?.id,
      }),
    );
    const [bulkRemoved] = await settledActivity(other.id, "label_removed");
    expect(bulkRemoved?.eventData).toEqual({ name: "bug", color: "#f00" });

    await asMember(
      "/label",
      json("POST", {
        name: "urgent",
        color: "#00f",
        taskId: task.id,
        workspaceId: workspace.id,
      }),
    );
    const created = await settledActivity(task.id, "label_added", 2);
    expect(created[1]?.eventData).toEqual({ name: "urgent", color: "#00f" });
  });
});

describe("description saves", () => {
  it("folds one person's saves within ten minutes into one row", async () => {
    const { asMember, asAdmin, createTask, member, admin } = await scene();
    const task = await createTask({ description: "v0" });
    const save = (request: typeof asMember, description: string) =>
      request(`/task/description/${task.id}`, json("PUT", { description }));

    await save(asMember, "v1");
    const [first] = await settledActivity(task.id, "description_changed");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await save(asMember, "v2");
    await vi.waitFor(
      async () => {
        const rows = await activityRows(task.id, "description_changed");
        expect(rows).toHaveLength(1);
        expect(rows[0]?.createdAt.getTime()).toBeGreaterThan(
          first?.createdAt.getTime() ?? 0,
        );
      },
      { timeout: 5000, interval: 25 },
    );

    await save(asAdmin, "v3");
    const both = await settledActivity(task.id, "description_changed", 2);
    expect(both.map((row) => row.userId)).toEqual([member.id, admin.id]);

    // Push both rows back so the admin's, still the newest, is 11 minutes
    // old: the admin's next save is a new row.
    await db
      .update(schema.activityTable)
      .set({ createdAt: sql`localtimestamp - interval '20 minutes'` })
      .where(eq(schema.activityTable.id, both[0]?.id ?? ""));
    await db
      .update(schema.activityTable)
      .set({ createdAt: sql`localtimestamp - interval '11 minutes'` })
      .where(eq(schema.activityTable.id, both[1]?.id ?? ""));
    await save(asAdmin, "v4");
    await settledActivity(task.id, "description_changed", 3);

    // Saving the same text records nothing.
    await save(asAdmin, "v4");
    await quiet();
    expect(await activityRows(task.id, "description_changed")).toHaveLength(3);
  });
});

describe("relations and parents", () => {
  it("writes both sides of a relation from each task's point of view", async () => {
    const { asMember, createTask } = await scene();
    const a = await createTask({ title: "Alpha" });
    const b = await createTask({ title: "Bravo" });

    const created = await asMember(
      "/task-relation",
      json("POST", {
        sourceTaskId: a.id,
        targetTaskId: b.id,
        relationType: "blocked_by",
      }),
    );
    const relation = (await created.json()) as { id: string };
    const [onA] = await settledActivity(a.id, "relation_added");
    const [onB] = await settledActivity(b.id, "relation_added");
    expect(onA?.eventData).toEqual({
      relation: "blocked_by",
      otherTaskId: b.id,
      otherTaskKey: `WEB-${b.number}`,
      otherTaskTitle: "Bravo",
      otherProjectId: b.projectId,
    });
    expect(onB?.eventData).toMatchObject({
      relation: "blocking",
      otherTaskId: a.id,
    });

    await asMember(`/task-relation/${relation.id}`, { method: "DELETE" });
    const [removedA] = await settledActivity(a.id, "relation_removed");
    const [removedB] = await settledActivity(b.id, "relation_removed");
    expect(removedA?.eventData).toMatchObject({
      relation: "blocked_by",
      otherTaskId: b.id,
    });
    expect(removedB?.eventData).toMatchObject({
      relation: "blocking",
      otherTaskId: a.id,
    });
  });

  it("records a new sub-task on both tasks", async () => {
    const { asMember, createTask } = await scene();
    const parent = await createTask({ title: "Parent" });
    const child = await createTask({ title: "Child" });
    await asMember(
      "/task-relation",
      json("POST", {
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      }),
    );
    const [added] = await settledActivity(parent.id, "subtask_added");
    expect(added?.eventData).toMatchObject({
      otherTaskId: child.id,
      otherTaskTitle: "Child",
    });
    const [changed] = await settledActivity(child.id, "parent_changed");
    expect(changed?.eventData).toEqual({
      oldParent: null,
      newParent: {
        id: parent.id,
        key: `WEB-${parent.number}`,
        title: "Parent",
        projectId: parent.projectId,
      },
    });
  });

  it("records a parent change once on the child and on both parents", async () => {
    const { asMember, createTask } = await scene();
    const first = await createTask({ title: "First" });
    const second = await createTask({ title: "Second" });
    const child = await createTask({ title: "Child" });
    await asMember(
      `/task-relation/parent/${child.id}`,
      json("PUT", { parentTaskId: first.id }),
    );
    await settledActivity(child.id, "parent_changed");

    await asMember(
      `/task-relation/parent/${child.id}`,
      json("PUT", { parentTaskId: second.id }),
    );
    const rows = await settledActivity(child.id, "parent_changed", 2);
    expect(rows[1]?.eventData).toMatchObject({
      oldParent: { id: first.id, title: "First" },
      newParent: { id: second.id, title: "Second" },
    });
    await settledActivity(first.id, "subtask_removed");
    await settledActivity(second.id, "subtask_added");
    await quiet();
    expect(await activityRows(child.id, "parent_changed")).toHaveLength(2);
  });

  it("writes nothing on other tasks when a task is deleted", async () => {
    const { asAdmin, createTask } = await scene();
    const kept = await createTask();
    const doomed = await createTask();
    await asAdmin(
      "/task-relation",
      json("POST", {
        sourceTaskId: kept.id,
        targetTaskId: doomed.id,
        relationType: "related",
      }),
    );
    await settledActivity(kept.id, "relation_added");

    expect(
      (await asAdmin(`/task/${doomed.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    await quiet();
    expect(await activityRows(kept.id, "relation_removed")).toEqual([]);
  });
});

describe("links and attachments", () => {
  it("records link and attachment changes with their snapshots", async () => {
    const { asMember, createTask } = await scene();
    const task = await createTask();

    const created = await asMember(
      `/task-link/${task.id}`,
      json("POST", { url: "example.com/spec", title: "Spec" }),
    );
    const link = (await created.json()) as { id: string };
    const [added] = await settledActivity(task.id, "link_added");
    expect(added?.eventData).toEqual({
      linkId: link.id,
      url: "https://example.com/spec",
      title: "Spec",
      host: "example.com",
    });
    await asMember(
      `/task-link/${task.id}/${link.id}`,
      json("PATCH", { title: "Spec v2" }),
    );
    const [updated] = await settledActivity(task.id, "link_updated");
    expect(updated?.eventData).toMatchObject({
      title: "Spec v2",
      oldTitle: "Spec",
    });
    await asMember(`/task-link/${task.id}/${link.id}`, { method: "DELETE" });
    await settledActivity(task.id, "link_removed");

    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 42,
      ContentType: "text/plain",
    } as never);
    const upload = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", {
        filename: "notes.txt",
        contentType: "text/plain",
        size: 42,
      }),
    );
    const { key } = (await upload.json()) as { key: string };
    const finalized = await asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", {
        key,
        filename: "notes.txt",
        contentType: "text/plain",
        size: 42,
      }),
    );
    const attachment = (await finalized.json()) as { id: string };
    const [attached] = await settledActivity(task.id, "attachment_added");
    expect(attached?.eventData).toEqual({
      attachmentId: attachment.id,
      filename: "notes.txt",
      size: 42,
      mimeType: "text/plain",
    });
    await asMember(`/task-attachment/${task.id}/${attachment.id}`, {
      method: "DELETE",
    });
    const [detached] = await settledActivity(task.id, "attachment_removed");
    expect(detached?.eventData).toMatchObject({ filename: "notes.txt" });
  });
});
