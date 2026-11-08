import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { resetTestDatabase } from "./helpers/database";
import { queryScene } from "./helpers/task-query";

// The cross-project timeline's request, as the web sends it: dated tasks only,
// one group per project, through the task query engine.

const DATED = {
  op: "or",
  children: [
    { key: "startDate", operator: "notEmpty" },
    { key: "dueDate", operator: "notEmpty" },
  ],
};

const TIMELINE = {
  filters: DATED,
  archived: "exclude",
  display: {
    groupBy: "project",
    subGroupBy: null,
    orderBy: { field: "dueDate", direction: "asc" },
    showSubTasks: true,
    showEmptyGroups: false,
  },
  page: { limit: 50 },
  mode: "rows",
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("API integration: workspace timeline", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns dated tasks grouped by project, without empty projects", async () => {
    const s = await queryScene();
    const other = await s.createProject("api", "API");
    await s.createProject("empty", "Empty");
    const dueOnly = await s.createTask({ dueDate: day("2026-03-05") });
    const startOnly = await s.createTask({ startDate: day("2026-03-01") });
    await s.createTask({});
    const inOther = await s.createTask({
      projectId: other.id,
      startDate: day("2026-03-02"),
      dueDate: day("2026-03-09"),
    });

    const result = await s.query(TIMELINE);
    const groups = new Map(result.groups.map((group) => [group.key, group]));
    expect([...groups.keys()].sort()).toEqual([other.id, s.project.id].sort());
    expect(groups.get(s.project.id)?.count).toBe(2);
    expect(groups.get(s.project.id)?.taskIds?.sort()).toEqual(
      [dueOnly.id, startOnly.id].sort(),
    );
    expect(groups.get(other.id)?.taskIds).toEqual([inOther.id]);
    expect(result.tasks[inOther.id]?.key).toMatch(/^API-|^api-/);
    expect(result.meta.projects.map((project) => project.name)).toEqual(
      expect.arrayContaining(["Web", "API"]),
    );
    expect(
      result.meta.columns.some((column) => column.projectId === other.id),
    ).toBe(true);
  });

  it("combines with a view's own filters", async () => {
    const s = await queryScene();
    const high = await s.createTask({
      priority: "high",
      dueDate: day("2026-03-05"),
    });
    await s.createTask({ priority: "low", dueDate: day("2026-03-05") });
    await s.createTask({ priority: "high" });

    const result = await s.query({
      ...TIMELINE,
      filters: {
        op: "and",
        children: [
          DATED,
          { key: "priority", operator: "in", values: ["high"] },
        ],
      },
    });
    expect(result.totalCount).toBe(1);
    expect(result.groups[0]?.taskIds).toEqual([high.id]);
  });

  it("keeps a restricted project from whoever can't see it", async () => {
    const s = await queryScene();
    const secret = await s.createProject("secret", "Secret");
    await s.createTask({ dueDate: day("2026-03-05") });
    const hidden = await s.createTask({
      projectId: secret.id,
      dueDate: day("2026-03-06"),
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, secret.id));
    await db
      .insert(projectMemberTable)
      .values({ projectId: secret.id, userId: s.cara.id });

    const asBen = await s.query(TIMELINE, s.ben);
    expect(asBen.groups.map((group) => group.key)).toEqual([s.project.id]);
    expect(asBen.tasks[hidden.id]).toBeUndefined();
    expect(asBen.meta.projects.map((project) => project.name)).toEqual(["Web"]);

    const asCara = await s.query(TIMELINE, s.cara);
    expect(asCara.groups.map((group) => group.key).sort()).toEqual(
      [s.project.id, secret.id].sort(),
    );
  });

  it("pages one project at a time", async () => {
    const s = await queryScene();
    for (const value of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
      await s.createTask({ dueDate: day(value) });
    }
    const first = await s.query({ ...TIMELINE, page: { limit: 2 } });
    const group = first.groups[0];
    expect(group?.count).toBe(3);
    expect(group?.taskIds).toHaveLength(2);
    expect(group?.nextCursor).toBeTruthy();

    const next = await s.query({
      ...TIMELINE,
      page: { limit: 2, group: group?.key, cursor: group?.nextCursor },
    });
    expect(next.groups[0]?.taskIds).toHaveLength(1);
    expect(next.groups[0]?.nextCursor).toBeNull();
  });
});
