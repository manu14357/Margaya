import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { orderedIds, queryScene } from "./helpers/task-query";

const STALE = "These results changed; reload the list";

/** 237 to-do tasks by position: even ones high, odd ones low. */
async function bigBoard() {
  const s = await queryScene();
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const rows = await db
    .insert(schema.taskTable)
    .values(
      Array.from({ length: 237 }, (_, i) => ({
        projectId: s.project.id,
        title: `Task ${i + 1}`,
        number: i + 1,
        position: i + 1,
        status: "to-do",
        columnId: s.columns.todo.id,
        priority: i % 2 === 0 ? "high" : "low",
        createdAt: new Date(base + i * 1000),
        updatedAt: new Date(base + i * 1000),
      })),
    )
    .returning({
      id: schema.taskTable.id,
      priority: schema.taskTable.priority,
    });
  const high = rows
    .filter((row) => row.priority === "high")
    .map((row) => row.id);
  return { ...s, high };
}

describe("API integration: task query paging", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("pages each group and walks one group to its end without duplicates", async () => {
    const s = await bigBoard();
    const body = {
      scope: { projectIds: [s.project.id] },
      display: { groupBy: "priority" },
      page: { limit: 50 },
    };
    const first = await s.query(body);
    expect(first.groups.map((group) => [group.key, group.count])).toEqual([
      ["high", 119],
      ["low", 118],
    ]);
    const firstHigh = first.groups[0];
    expect(firstHigh?.taskIds).toHaveLength(50);
    expect(first.groups[1]?.taskIds).toHaveLength(50);

    const walked = [...(firstHigh?.taskIds ?? [])];
    let cursor = firstHigh?.nextCursor ?? null;
    let pages = 1;
    while (cursor) {
      const next = await s.query({
        ...body,
        page: { limit: 50, group: "high", cursor },
      });
      expect(next.groups.map((group) => group.key)).toEqual(["high"]);
      expect(next.groups[0]?.count).toBe(119);
      walked.push(...(next.groups[0]?.taskIds ?? []));
      cursor = next.groups[0]?.nextCursor ?? null;
      pages += 1;
    }
    expect(pages).toBe(3);
    expect(new Set(walked).size).toBe(119);
    // Manual order: position ascending, every row once.
    expect(walked).toEqual(s.high);
  });

  it("refuses a cursor from another query and unknown groups", async () => {
    const s = await bigBoard();
    const body = { display: { groupBy: "priority" }, page: { limit: 10 } };
    const first = await s.query(body);
    const cursor = first.groups[0]?.nextCursor;
    expect(cursor).toBeTruthy();

    await s.refuse(
      {
        ...body,
        archived: "include",
        page: { limit: 10, group: "high", cursor },
      },
      400,
      STALE,
    );
    await s.refuse(
      { ...body, page: { limit: 10, group: "low", cursor } },
      400,
      STALE,
    );
    await s.refuse(
      { ...body, page: { limit: 10, group: "medium" } },
      400,
      STALE,
    );
    await s.refuse(
      { ...body, page: { limit: 10, group: "high", cursor: "garbage" } },
      400,
      STALE,
    );
  });

  it("pages ungrouped lists through the all group", async () => {
    const s = await bigBoard();
    const first = await s.query({ page: { limit: 100 } });
    expect(first.groups).toHaveLength(1);
    expect(first.groups[0]?.key).toBe("all");
    expect(first.groups[0]?.count).toBe(237);
    const seen = [...orderedIds(first)];
    let cursor = first.groups[0]?.nextCursor;
    while (cursor) {
      const next = await s.query({
        page: { limit: 100, group: "all", cursor },
      });
      seen.push(...orderedIds(next));
      cursor = next.groups[0]?.nextCursor;
    }
    expect(seen).toHaveLength(237);
    expect(new Set(seen).size).toBe(237);
  });

  it("orders by the allow-listed fields with nulls last and stable ties", async () => {
    const s = await queryScene();
    const day = (d: number) => new Date(Date.UTC(2026, 8, d));
    const early = await s.createTask({
      title: "banana",
      dueDate: day(1),
      priority: "low",
    });
    const late = await s.createTask({
      title: "Apple",
      dueDate: day(9),
      priority: "urgent",
    });
    const tieOld = await s.createTask({
      title: "cherry",
      dueDate: day(5),
      priority: "high",
    });
    const tieNew = await s.createTask({
      title: "date",
      dueDate: day(5),
      priority: "high",
    });
    const undated = await s.createTask({
      title: "elder",
      dueDate: null,
      priority: "no-priority",
    });
    const order = async (field: string, direction?: string) =>
      orderedIds(await s.query({ display: { orderBy: { field, direction } } }));

    // Ties break by createdAt descending: the newer task first.
    expect(await order("dueDate", "asc")).toEqual([
      early.id,
      tieNew.id,
      tieOld.id,
      late.id,
      undated.id,
    ]);
    expect(await order("dueDate", "desc")).toEqual([
      late.id,
      tieNew.id,
      tieOld.id,
      early.id,
      undated.id,
    ]);
    expect(await order("priority")).toEqual([
      late.id,
      tieNew.id,
      tieOld.id,
      early.id,
      undated.id,
    ]);
    expect(await order("title")).toEqual([
      late.id,
      early.id,
      tieOld.id,
      tieNew.id,
      undated.id,
    ]);
    // Workspace scope defaults to newest first.
    expect(await order("createdAt")).toEqual([
      undated.id,
      tieNew.id,
      tieOld.id,
      late.id,
      early.id,
    ]);
    for (const field of [
      "manual",
      "updatedAt",
      "completedAt",
      "startDate",
      "number",
      "status",
      "assignee",
      "label",
      "cycle",
      "module",
      "estimate",
      "subTaskCount",
    ]) {
      for (const direction of ["asc", "desc"]) {
        expect(sortedCopy(await order(field, direction))).toEqual(
          sortedCopy([early.id, late.id, tieOld.id, tieNew.id, undated.id]),
        );
      }
    }
  });

  it("returns every id in ids mode, and none past 20,000 matches", async () => {
    const s = await bigBoard();
    const all = await s.query({ mode: "ids" });
    expect(all.ids).toHaveLength(237);
    expect(all.truncated).toBe(false);
    expect(all.totalCount).toBe(237);
    expect(all.groups).toEqual([]);

    await db.execute(sql`
      insert into ${schema.taskTable} (id, project_id, title, number, status, column_id, priority)
      select 'bulk-' || g, ${s.project.id}, 'Bulk ' || g, 1000 + g, 'to-do', ${s.columns.todo.id}, 'low'
      from generate_series(1, 20000) as g
    `);
    const many = await s.query({ mode: "ids" });
    expect(many.truncated).toBe(true);
    expect(many.ids).toEqual([]);
    expect(many.totalCount).toBe(20_237);
  });
});

function sortedCopy(values: readonly string[]) {
  return [...values].sort();
}
