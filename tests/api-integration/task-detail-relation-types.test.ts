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

type RelationJson = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
};

recordEvents("task-relation.created", "task-relation.deleted");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function scene() {
  const s = await taskDetailScene();
  const asMember = s.as(s.member);
  const relate = (
    sourceTaskId: string,
    targetTaskId: string,
    relationType: string,
  ) =>
    asMember(
      "/task-relation",
      json("POST", { sourceTaskId, targetTaskId, relationType }),
    );
  return { ...s, asMember, relate };
}

async function expectRefused(
  response: Response,
  status: number,
  message: string,
) {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe(message);
}

describe("relation types", () => {
  it.each([
    ["subtask", "subtask", false],
    ["blocks", "blocks", false],
    ["blocking", "blocks", false],
    ["blocked_by", "blocks", true],
    ["related", "related", false],
    ["duplicate", "duplicate", false],
    ["start_before", "start_before", false],
    ["start_after", "start_before", true],
    ["finish_before", "finish_before", false],
    ["finish_after", "finish_before", true],
  ])("%s is stored as %s (flipped: %s)", async (input, stored, flipped) => {
    const { createTask, relate } = await scene();
    const x = await createTask();
    const y = await createTask();
    const response = await relate(x.id, y.id, input);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceTaskId: flipped ? y.id : x.id,
      targetTaskId: flipped ? x.id : y.id,
      relationType: stored,
    });
  });

  it("lists relations oldest first with each task's project and group", async () => {
    const { asMember, createTask, relate, project, workspace } = await scene();
    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
      name: "Mobile",
      slug: "app",
    });
    const me = await createTask({ title: "Me" });
    const done = await createTask({ title: "Done one", status: "done" });
    const planned = await createTask({ title: "Planned", status: "planned" });
    const elsewhere = await createTask({
      projectId: other.id,
      title: "Elsewhere",
    });

    await relate(me.id, done.id, "blocked_by");
    await relate(me.id, planned.id, "related");
    await relate(me.id, elsewhere.id, "start_before");

    const response = await asMember(`/task-relation/${me.id}`);
    expect(response.status).toBe(200);
    const relations = (await response.json()) as Array<
      RelationJson & {
        sourceTask: {
          id: string;
          projectSlug: string;
          projectName: string;
          group: string | null;
        };
        targetTask: {
          id: string;
          projectSlug: string;
          projectName: string;
          group: string | null;
        };
      }
    >;
    expect(relations.map((relation) => relation.relationType)).toEqual([
      "blocks",
      "related",
      "start_before",
    ]);
    expect(relations[0]?.sourceTask).toMatchObject({
      id: done.id,
      projectSlug: "web",
      projectName: project.name,
      group: "completed",
    });
    expect(relations[1]?.targetTask).toMatchObject({
      id: planned.id,
      group: "backlog",
    });
    expect(relations[2]?.targetTask).toMatchObject({
      id: elsewhere.id,
      projectSlug: "app",
      projectName: "Mobile",
      group: "unstarted",
    });
  });

  it("keeps one non-subtask relation per pair", async () => {
    const { createTask, relate } = await scene();
    const a = await createTask();
    const b = await createTask();
    expect((await relate(a.id, b.id, "blocks")).status).toBe(200);

    await expectRefused(
      await relate(b.id, a.id, "blocked_by"),
      409,
      "This relation already exists",
    );
    await expectRefused(
      await relate(b.id, a.id, "blocks"),
      409,
      "This relation already exists",
    );
    await expectRefused(
      await relate(b.id, a.id, "related"),
      409,
      "These tasks are already related. Remove the existing relation first.",
    );
    await expectRefused(
      await relate(a.id, b.id, "duplicate"),
      409,
      "These tasks are already related. Remove the existing relation first.",
    );
    // A parent-child link is separate from the pair rule.
    expect((await relate(a.id, b.id, "subtask")).status).toBe(200);
  });

  it("refuses a task related to itself", async () => {
    const { createTask, relate } = await scene();
    const a = await createTask();
    for (const type of ["related", "blocked_by", "subtask"]) {
      await expectRefused(
        await relate(a.id, a.id, type),
        400,
        "Cannot create a relation between a task and itself",
      );
    }
  });

  it.each([
    ["blocks", "blocked_by"],
    ["start_before", "start_after"],
    ["finish_before", "finish_after"],
  ])("refuses a %s loop, whichever name closes it", async (type, inverse) => {
    const { createTask, relate } = await scene();
    const a = await createTask();
    const b = await createTask();
    const c = await createTask();
    expect((await relate(a.id, b.id, type)).status).toBe(200);
    expect((await relate(b.id, c.id, type)).status).toBe(200);

    const message = "This would create a circular dependency";
    await expectRefused(await relate(c.id, a.id, type), 400, message);
    await expectRefused(await relate(a.id, c.id, inverse), 400, message);
  });

  it("checks loops per type", async () => {
    const { createTask, relate } = await scene();
    const a = await createTask();
    const b = await createTask();
    const c = await createTask();
    expect((await relate(a.id, b.id, "blocks")).status).toBe(200);
    expect((await relate(b.id, c.id, "start_before")).status).toBe(200);
    expect((await relate(c.id, a.id, "finish_before")).status).toBe(200);
  });

  it("relates tasks across projects, never across workspaces", async () => {
    const { createTask, relate, workspace } = await scene();
    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const a = await createTask();
    const b = await createTask({ projectId: other.id });
    expect((await relate(a.id, b.id, "blocks")).status).toBe(200);

    const foreign = await createWorkspaceMember();
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const [outside] = await db
      .insert(schema.taskTable)
      .values({ projectId: foreignProject.id, title: "Foreign", number: 1 })
      .returning();
    await expectRefused(
      await relate(a.id, outside?.id ?? "", "related"),
      404,
      "Target task not found",
    );
    await expectRefused(
      await relate(a.id, outside?.id ?? "", "blocked_by"),
      404,
      "Target task not found",
    );
  });

  it("refuses tasks waiting in intake", async () => {
    const { createTask, relate, project } = await scene();
    await db.insert(schema.columnTable).values({
      projectId: project.id,
      name: "Triage",
      slug: "triage",
      position: -1,
      group: "triage",
    });
    const a = await createTask();
    const waiting = await createTask({ status: "triage" });
    await expectRefused(
      await relate(a.id, waiting.id, "related"),
      400,
      "Tasks waiting in intake can't be linked",
    );
    await expectRefused(
      await relate(waiting.id, a.id, "subtask"),
      400,
      "Tasks waiting in intake can't be linked",
    );
  });

  it("caps a task at 200 relations", async () => {
    const { createTask, relate } = await scene();
    const a = await createTask();
    const b = await createTask();
    const c = await createTask();
    await db.insert(schema.taskRelationTable).values(
      Array.from({ length: 200 }, () => ({
        sourceTaskId: a.id,
        targetTaskId: b.id,
        relationType: "related",
      })),
    );
    await expectRefused(
      await relate(c.id, a.id, "related"),
      400,
      "A task can have at most 200 relations",
    );
    // Sub-tasks don't count.
    expect((await relate(a.id, c.id, "subtask")).status).toBe(200);
  });

  it("lets viewers read but not relate", async () => {
    const { as, viewer, createTask } = await scene();
    const a = await createTask();
    const b = await createTask();
    const asViewer = as(viewer);
    expect((await asViewer(`/task-relation/${a.id}`)).status).toBe(200);
    expect(
      (
        await asViewer(
          "/task-relation",
          json("POST", {
            sourceTaskId: a.id,
            targetTaskId: b.id,
            relationType: "related",
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("publishes both projects, the origin and snapshots", async () => {
    const { asMember, createTask, relate, member, project, workspace } =
      await scene();
    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "ops",
    });
    const a = await createTask({ title: "Alpha" });
    const b = await createTask({ projectId: other.id, title: "Bravo" });
    const created = (await (
      await relate(a.id, b.id, "blocked_by")
    ).json()) as RelationJson;

    expect(
      publishedEvents("task-relation.created").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        id: created.id,
        taskId: b.id,
        projectId: other.id,
        targetProjectId: project.id,
        userId: member.id,
        origin: "user",
        relationType: "blocks",
        sourceTaskId: b.id,
        sourceTaskKey: "OPS-1",
        sourceTaskTitle: "Bravo",
        targetTaskId: a.id,
        targetTaskKey: "WEB-1",
        targetTaskTitle: "Alpha",
      }),
    ]);

    await asMember(`/task-relation/${created.id}`, { method: "DELETE" });
    expect(
      publishedEvents("task-relation.deleted").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        id: created.id,
        origin: "user",
        projectId: other.id,
        targetProjectId: project.id,
        sourceTaskKey: "OPS-1",
        targetTaskKey: "WEB-1",
      }),
    ]);
  });
});
