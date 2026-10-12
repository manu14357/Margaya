import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  inTriageColumnSql,
  inTriageColumnSqlOf,
} from "../../apps/api/src/task/scope";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { taskTable, columnTable } = schema;

// Project A has an ordinary column whose slug is "triage"; project B has a
// real triage column with the same slug. Only B's task waits in intake.
async function scene() {
  const { workspace } = await createWorkspaceMember();
  const { project: a } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const { project: b } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  await db.insert(columnTable).values([
    { projectId: a.id, name: "Triage", slug: "triage", group: "unstarted" },
    { projectId: b.id, name: "Triage", slug: "triage", group: "triage" },
  ]);
  const [boardTask] = await db
    .insert(taskTable)
    .values({
      projectId: a.id,
      title: "On the board",
      number: 1,
      status: "triage",
    })
    .returning();
  const [request] = await db
    .insert(taskTable)
    .values({ projectId: b.id, title: "Waiting", number: 1, status: "triage" })
    .returning();
  return { boardTask, request };
}

describe("API integration: the triage check in every query shape", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("reads a task's own project in a single-table select list (loadTask)", async () => {
    const { boardTask, request } = await scene();

    // The shape cycle and module loadTask use.
    const inTriage = async (id: string) =>
      (
        await db
          .select({ id: taskTable.id, inTriage: inTriageColumnSql })
          .from(taskTable)
          .where(eq(taskTable.id, id))
      )[0]?.inTriage;

    expect(await inTriage(boardTask.id)).toBe(false);
    expect(await inTriage(request.id)).toBe(true);
  });

  it("filters the same way in where clauses, with aliases and in updates", async () => {
    const { boardTask, request } = await scene();

    const waiting = await db
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(inTriageColumnSql);
    expect(waiting.map((row) => row.id)).toEqual([request.id]);

    const other = alias(taskTable, "other_task");
    const aliased = await db
      .select({ id: other.id })
      .from(other)
      .where(sql`not ${inTriageColumnSqlOf(other)}`);
    expect(aliased.map((row) => row.id)).toEqual([boardTask.id]);

    const updated = await db
      .update(taskTable)
      .set({ title: "Touched" })
      .where(inTriageColumnSql)
      .returning({ id: taskTable.id });
    expect(updated.map((row) => row.id)).toEqual([request.id]);
  });
});
