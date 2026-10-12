import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  assigneeDetailsOfTasks,
  assigneeRankSql,
  assigneeRowsSubquery,
  assigneesOfTask,
  assigneesOfTaskSql,
  assigneesOfTasks,
  hasAnyAssignee,
  hasNoAssigneeSql,
  taskAssigneeJoin,
} from "../../apps/api/src/task/assignees";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { taskAssigneeTable, taskTable } = schema;

async function scene() {
  const owner = await createWorkspaceMember({ role: "owner", userName: "Ada" });
  const ben = await addPerson(owner.workspace.id, "Ben");
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const tasks = await db
    .insert(taskTable)
    .values(
      [1, 2, 3].map((number) => ({
        projectId: project.id,
        title: `Task ${number}`,
        number,
      })),
    )
    .returning();
  const [both, one, none] = tasks;
  if (!both || !one || !none) throw new Error("Failed to create tasks");
  await assignTask(both.id, [owner.user.id, ben.id]);
  await assignTask(one.id, [ben.id]);
  return { ada: owner.user, ben, project, both, one, none };
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("assignee readers and SQL fragments", () => {
  it("load in assignee order, one list per requested task", async () => {
    const { ada, ben, both, one, none } = await scene();

    const lists = await assigneesOfTasks([both.id, one.id, none.id, "gone"]);
    expect(Object.fromEntries(lists)).toEqual({
      [both.id]: [ada.id, ben.id],
      [one.id]: [ben.id],
      [none.id]: [],
      gone: [],
    });
    expect(await assigneesOfTask(both.id)).toEqual([ada.id, ben.id]);

    const details = await assigneeDetailsOfTasks([both.id]);
    expect(details.get(both.id)).toEqual([
      { id: ada.id, name: "Ada", image: null },
      { id: ben.id, name: "Ben", image: ben.image },
    ]);
  });

  it("filter any-of and none, and aggregate the ordered list", async () => {
    const { ada, ben, project, both, one, none } = await scene();
    const inProject = eq(taskTable.projectId, project.id);
    const ids = async (condition: ReturnType<typeof hasAnyAssignee>) =>
      (
        await db
          .select({ id: taskTable.id })
          .from(taskTable)
          .where(and(inProject, condition))
          .orderBy(asc(taskTable.number))
      ).map((row) => row.id);

    expect(await ids(hasAnyAssignee([ben.id]))).toEqual([both.id, one.id]);
    expect(await ids(hasAnyAssignee([ada.id, "nobody"]))).toEqual([both.id]);
    expect(await ids(hasAnyAssignee([]))).toEqual([]);
    expect(await ids(hasNoAssigneeSql)).toEqual([none.id]);

    const lists = await db
      .select({ id: taskTable.id, assigneeIds: assigneesOfTaskSql })
      .from(taskTable)
      .where(inProject)
      .orderBy(asc(taskTable.number));
    expect(lists.map((row) => row.assigneeIds)).toEqual([
      [ada.id, ben.id],
      [ben.id],
      [],
    ]);

    // Selected (not filtered on) in a single-table query as well.
    const flags = await db
      .select({
        hasBen: hasAnyAssignee([ben.id]),
        unassigned: hasNoAssigneeSql,
      })
      .from(taskTable)
      .where(inProject)
      .orderBy(asc(taskTable.number));
    expect(flags).toEqual([
      { hasBen: true, unassigned: false },
      { hasBen: true, unassigned: false },
      { hasBen: false, unassigned: true },
    ]);
  });

  it("fan tasks out per assignee with a rank", async () => {
    const { ada, ben, project, both, one, none } = await scene();

    const joined = await db
      .select({
        taskId: taskTable.id,
        userId: taskAssigneeTable.userId,
        rank: assigneeRankSql,
      })
      .from(taskTable)
      .leftJoin(taskAssigneeTable, taskAssigneeJoin)
      .where(eq(taskTable.projectId, project.id))
      .orderBy(asc(taskTable.number), asc(taskAssigneeTable.position));
    expect(
      joined.map((row) => [row.taskId, row.userId, row.userId ? row.rank : 0]),
    ).toEqual([
      [both.id, ada.id, 1],
      [both.id, ben.id, 2],
      [one.id, ben.id, 1],
      [none.id, null, 0],
    ]);

    const rows = assigneeRowsSubquery();
    const fanned = await db
      .select({ taskId: taskTable.id, userId: rows.userId, rank: rows.rank })
      .from(taskTable)
      .innerJoin(rows, eq(rows.taskId, taskTable.id))
      .where(eq(taskTable.projectId, project.id))
      .orderBy(asc(taskTable.number), asc(rows.rank));
    expect(fanned).toEqual([
      { taskId: both.id, userId: ada.id, rank: 1 },
      { taskId: both.id, userId: ben.id, rank: 2 },
      { taskId: one.id, userId: ben.id, rank: 1 },
    ]);
  });
});
