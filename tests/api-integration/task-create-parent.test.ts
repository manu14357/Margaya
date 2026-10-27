import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addPerson } from "./helpers/assignees";
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

recordEvents("task.created", "task-relation.created");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function scene() {
  const s = await taskDetailScene();
  const create = (
    user: typeof s.member,
    body: Record<string, unknown>,
    projectId = s.project.id,
  ) =>
    s.as(user)(
      `/task/${projectId}`,
      json("POST", {
        title: "Child",
        description: "",
        priority: "no-priority",
        status: "to-do",
        ...body,
      }),
    );
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
  const taskCount = async () =>
    (await db.select({ id: schema.taskTable.id }).from(schema.taskTable))
      .length;
  return { ...s, create, parentsOf, taskCount };
}

async function expectRefused(
  response: Response,
  status: number,
  message?: string,
) {
  expect(response.status).toBe(status);
  if (message) expect(await response.text()).toBe(message);
}

describe("creating a task with a parent", () => {
  it("creates the task and its parent link together and publishes both", async () => {
    const { create, createTask, member, parentsOf } = await scene();
    const parent = await createTask({ title: "Parent" });

    const response = await create(member, { parentId: parent.id });
    expect(response.status).toBe(200);
    const child = (await response.json()) as { id: string; number: number };
    expect(await parentsOf(child.id)).toEqual([parent.id]);

    expect(publishedEvents().map((event) => event.name)).toEqual([
      "task.created",
      "task-relation.created",
    ]);
    expect(publishedEvents("task-relation.created")[0]?.data).toMatchObject({
      sourceTaskId: parent.id,
      targetTaskId: child.id,
      relationType: "subtask",
      origin: "user",
      sourceTaskKey: `WEB-${parent.number}`,
      targetTaskKey: `WEB-${child.number}`,
      targetTaskTitle: "Child",
    });
  });

  it("creates nothing when the parent is refused", async () => {
    const { create, createTask, member, project, workspace, taskCount } =
      await scene();

    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const elsewhere = await createTask({ projectId: other.id });

    await db.insert(schema.columnTable).values({
      projectId: project.id,
      name: "Triage",
      slug: "triage",
      position: -1,
      group: "triage",
    });
    const waiting = await createTask({ status: "triage" });
    const trashed = await createTask({ deletedAt: new Date() });

    const foreign = await createWorkspaceMember();
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const [outside] = await db
      .insert(schema.taskTable)
      .values({ projectId: foreignProject.id, title: "Foreign", number: 1 })
      .returning();

    const before = await taskCount();
    await expectRefused(
      await create(member, { parentId: elsewhere.id }),
      400,
      "The parent must be in the same project",
    );
    await expectRefused(
      await create(member, { parentId: waiting.id }),
      400,
      "Tasks waiting in intake can't be linked",
    );
    await expectRefused(
      await create(member, { parentId: trashed.id }),
      404,
      "Parent task not found",
    );
    await expectRefused(
      await create(member, { parentId: outside?.id ?? "" }),
      404,
      "Parent task not found",
    );
    await expectRefused(
      await create(member, { parentId: "missing" }),
      404,
      "Parent task not found",
    );
    const parent = await createTask();
    // The create route never places a task in intake, parent or not.
    await expectRefused(
      await create(member, { parentId: parent.id, status: "triage" }),
      400,
    );

    // Refused creates leave no task behind (only the fixture above was added).
    expect(await taskCount()).toBe(before + 1);
    expect(publishedEvents()).toEqual([]);
  });

  it("needs task:update besides task:create", async () => {
    const { create, createTask, workspace, taskCount } = await scene();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: "creator",
      permission: JSON.stringify({
        workspace: ["read"],
        project: ["read"],
        task: ["read", "create"],
      }),
    });
    const creator = await addPerson(workspace.id, "Cy", "creator");
    const parent = await createTask();
    const before = await taskCount();

    await expectRefused(await create(creator, { parentId: parent.id }), 403);
    expect(await taskCount()).toBe(before);

    // The same role can still create a task without a parent.
    expect((await create(creator, {})).status).toBe(200);
  });
});
