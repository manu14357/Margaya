import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  type DraftJson,
  draftScene,
  type PublishedJson,
} from "./helpers/drafts";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
  settle,
} from "./helpers/intake";

recordEvents("task-relation.created");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

type DraftWithParent = DraftJson & {
  parentTaskId: string | null;
  parentTask: { id: string; key: string; title: string } | null;
};

async function insertTask(projectId: string, title: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, number, status: "to-do" })
    .returning();
  if (!task) throw new Error("Failed to create task");
  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: number })
    .where(eq(schema.projectTable.id, projectId));
  return task;
}

async function subtaskLink(parentId: string, childId: string) {
  const [row] = await db
    .select()
    .from(schema.taskRelationTable)
    .where(
      and(
        eq(schema.taskRelationTable.sourceTaskId, parentId),
        eq(schema.taskRelationTable.targetTaskId, childId),
        eq(schema.taskRelationTable.relationType, "subtask"),
      ),
    );
  return row ?? null;
}

describe("a draft's parent", () => {
  it("is stored, shown with its key and linked when publishing", async () => {
    const s = await draftScene();
    const parent = await insertTask(s.web.project.id, "Epic", 1);

    const draft = (await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Child",
      parentTaskId: parent.id,
    })) as DraftWithParent;
    expect(draft.parentTaskId).toBe(parent.id);
    expect(draft.parentTask).toEqual({
      id: parent.id,
      key: "WEB-1",
      title: "Epic",
    });

    clearPublishedEvents();
    const published = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${draft.id}/publish`,
    );
    expect(published.dropped).toEqual([]);
    expect(await subtaskLink(parent.id, published.task.id)).not.toBeNull();
    await settle();
    expect(publishedEvents("task-relation.created")).toHaveLength(1);
  });

  it("must be a task of the draft's project", async () => {
    const s = await draftScene();
    const other = await insertTask(s.api.project.id, "Elsewhere", 1);

    const response = await s.as(s.mia)("POST", "/task-draft", {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      parentTaskId: other.id,
    });
    expect(response.status).toBe(400);

    const noProject = await s.as(s.mia)("POST", "/task-draft", {
      workspaceId: s.workspaceId,
      parentTaskId: other.id,
    });
    expect(noProject.status).toBe(400);
  });

  it("is cleared when the draft moves to another project", async () => {
    const s = await draftScene();
    const parent = await insertTask(s.web.project.id, "Epic", 1);
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      parentTaskId: parent.id,
    });

    const moved = await s.ok<DraftWithParent>(
      s.mia,
      "PATCH",
      `/task-draft/${draft.id}`,
      { projectId: s.api.project.id },
    );
    expect(moved.parentTaskId).toBeNull();
    expect((await s.draftRow(draft.id))?.parentTaskId).toBeNull();
  });

  it("is dropped, not blocking, when it was trashed meanwhile", async () => {
    const s = await draftScene();
    const parent = await insertTask(s.web.project.id, "Epic", 1);
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "Child",
      parentTaskId: parent.id,
    });
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, parent.id));

    const listed = await s.ok<{ drafts: DraftWithParent[] }>(
      s.mia,
      "GET",
      `/task-draft?workspaceId=${s.workspaceId}`,
    );
    expect(listed.drafts[0]?.parentTask).toBeNull();

    const published = await s.ok<PublishedJson>(
      s.mia,
      "POST",
      `/task-draft/${draft.id}/publish`,
    );
    expect(published.dropped).toEqual(["parent"]);
    expect(await subtaskLink(parent.id, published.task.id)).toBeNull();
  });

  it("is set null when the parent task is deleted for good", async () => {
    const s = await draftScene();
    const parent = await insertTask(s.web.project.id, "Epic", 1);
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      parentTaskId: parent.id,
    });
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, parent.id));
    expect((await s.draftRow(draft.id))?.parentTaskId).toBeNull();
  });
});
