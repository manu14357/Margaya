import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  taskDetailScene,
} from "./helpers/task-detail";

recordEvents(
  "task-relation.created",
  "task-relation.deleted",
  "task.parent_changed",
);

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

type ParentJson = {
  taskId: string;
  parent: {
    id: string;
    projectSlug: string;
    number: number;
    title: string;
  } | null;
};

async function scene() {
  const s = await taskDetailScene();
  const asMember = s.as(s.member);
  const setParent = (taskId: string, parentTaskId: string | null) =>
    asMember(`/task-relation/parent/${taskId}`, json("PUT", { parentTaskId }));
  const parentsOf = async (taskId: string) =>
    (
      await db
        .select({ sourceTaskId: schema.taskRelationTable.sourceTaskId })
        .from(schema.taskRelationTable)
        .where(
          and(
            eq(schema.taskRelationTable.targetTaskId, taskId),
            eq(schema.taskRelationTable.relationType, "subtask"),
          ),
        )
    ).map((row) => row.sourceTaskId);
  return { ...s, asMember, setParent, parentsOf };
}

async function expectRefused(
  response: Response,
  status: number,
  message: string,
) {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe(message);
}

describe("the parent route", () => {
  it("sets, changes and clears the parent in single calls", async () => {
    const { createTask, setParent, parentsOf } = await scene();
    const child = await createTask({ title: "Child" });
    const first = await createTask({ title: "First" });
    const second = await createTask({ title: "Second" });

    const set = await setParent(child.id, first.id);
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      taskId: child.id,
      parent: { id: first.id, projectSlug: "web", title: "First" },
    });
    expect(await parentsOf(child.id)).toEqual([first.id]);

    expect((await setParent(child.id, second.id)).status).toBe(200);
    expect(await parentsOf(child.id)).toEqual([second.id]);

    const cleared = await setParent(child.id, null);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ taskId: child.id, parent: null });
    expect(await parentsOf(child.id)).toEqual([]);
  });

  it("changes nothing when asked for the current state", async () => {
    const { createTask, setParent } = await scene();
    const child = await createTask();
    const parent = await createTask();
    expect((await setParent(child.id, null)).status).toBe(200);
    await setParent(child.id, parent.id);
    clearPublishedEvents();

    const again = await setParent(child.id, parent.id);
    expect(again.status).toBe(200);
    expect(((await again.json()) as ParentJson).parent?.id).toBe(parent.id);
    expect(publishedEvents()).toEqual([]);
  });

  it("refuses itself, its own sub-tasks, other projects, intake and other workspaces", async () => {
    const { createTask, setParent, workspace, project } = await scene();
    const top = await createTask();
    const middle = await createTask();
    const bottom = await createTask();
    await setParent(middle.id, top.id);
    await setParent(bottom.id, middle.id);

    await expectRefused(
      await setParent(top.id, top.id),
      400,
      "A task can't be its own parent",
    );
    await expectRefused(
      await setParent(top.id, bottom.id),
      400,
      "A task can't be a subtask of its own subtask",
    );

    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const elsewhere = await createTask({ projectId: other.id });
    await expectRefused(
      await setParent(top.id, elsewhere.id),
      400,
      "The parent must be in the same project",
    );

    await db.insert(schema.columnTable).values({
      projectId: project.id,
      name: "Triage",
      slug: "triage",
      position: -1,
      group: "triage",
    });
    const waiting = await createTask({ status: "triage" });
    await expectRefused(
      await setParent(top.id, waiting.id),
      400,
      "Tasks waiting in intake can't be linked",
    );

    const foreign = await createWorkspaceMember();
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const [outside] = await db
      .insert(schema.taskTable)
      .values({ projectId: foreignProject.id, title: "Foreign", number: 1 })
      .returning();
    await expectRefused(
      await setParent(top.id, outside?.id ?? ""),
      404,
      "Parent task not found",
    );
    await expectRefused(
      await setParent(top.id, "missing"),
      404,
      "Parent task not found",
    );
  });

  it("keeps POST subtask to one parent", async () => {
    const { asMember, createTask, setParent } = await scene();
    const child = await createTask();
    const parent = await createTask();
    const other = await createTask();
    await setParent(child.id, parent.id);

    const relate = (sourceTaskId: string) =>
      asMember(
        "/task-relation",
        json("POST", {
          sourceTaskId,
          targetTaskId: child.id,
          relationType: "subtask",
        }),
      );
    await expectRefused(
      await relate(other.id),
      409,
      "This task already has a parent. Change the parent instead.",
    );
    await expectRefused(
      await relate(parent.id),
      409,
      "This relation already exists",
    );
  });

  it("replaces every legacy parent at once", async () => {
    const { createTask, setParent, parentsOf } = await scene();
    const child = await createTask();
    const oldest = await createTask();
    const newer = await createTask();
    const next = await createTask();
    for (const parent of [oldest, newer]) {
      await db.insert(schema.taskRelationTable).values({
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      });
    }

    // Asking for one of two parents is still a change.
    expect((await setParent(child.id, oldest.id)).status).toBe(200);
    expect(await parentsOf(child.id)).toEqual([oldest.id]);

    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: newer.id,
      targetTaskId: child.id,
      relationType: "subtask",
    });
    clearPublishedEvents();
    expect((await setParent(child.id, next.id)).status).toBe(200);
    expect(await parentsOf(child.id)).toEqual([next.id]);

    expect(publishedEvents().map((event) => event.name)).toEqual([
      "task-relation.deleted",
      "task-relation.deleted",
      "task-relation.created",
      "task.parent_changed",
    ]);
    expect(publishedEvents("task.parent_changed")[0]?.data).toMatchObject({
      taskId: child.id,
      oldParent: { id: oldest.id, key: `WEB-${oldest.number}` },
      newParent: { id: next.id, key: `WEB-${next.number}`, title: next.title },
      type: "parent_changed",
    });
    for (const event of publishedEvents()) {
      if (event.name.startsWith("task-relation.")) {
        expect(event.data.origin).toBe("parent_change");
      }
    }
  });

  it("is for editors only", async () => {
    const { as, viewer, createTask } = await scene();
    const child = await createTask();
    const parent = await createTask();
    const response = await as(viewer)(
      `/task-relation/parent/${child.id}`,
      json("PUT", { parentTaskId: parent.id }),
    );
    expect(response.status).toBe(403);
  });
});
