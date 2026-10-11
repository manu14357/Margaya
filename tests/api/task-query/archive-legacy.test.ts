import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_STATUS,
  archivedCondition,
  isTaskArchived,
  parseStatusInput,
  resolveCompletedAt,
  visibleTaskCondition,
} from "../../../apps/api/src/task/scope";

const dialect = new PgDialect();

describe("the legacy archived status input (D7)", () => {
  it("turns archived into an archive request and keeps real statuses", () => {
    expect(parseStatusInput(ARCHIVED_STATUS)).toEqual({ archive: true });
    expect(parseStatusInput("to-do")).toEqual({
      archive: false,
      status: "to-do",
    });
    expect(parseStatusInput("planned")).toEqual({
      archive: false,
      status: "planned",
    });
  });

  it("reads archiving from archivedAt, not the status", () => {
    expect(isTaskArchived({ archivedAt: new Date() })).toBe(true);
    expect(isTaskArchived({ archivedAt: null })).toBe(false);
  });

  it("never lets archiving touch completion", () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-02-01T00:00:00.000Z");
    expect(resolveCompletedAt(earlier, "completed", now)).toBe(earlier);
    expect(resolveCompletedAt(earlier, "started", now)).toBeNull();
  });
});

describe("archived scopes", () => {
  it("filters on archived_at and always leaves out trashed tasks", () => {
    const render = (scope: "exclude" | "include" | "only") =>
      dialect.sqlToQuery(archivedCondition(scope)).sql;
    expect(render("exclude")).toBe(
      '("task"."deleted_at" is null and "task"."archived_at" is null)',
    );
    expect(render("only")).toBe(
      '("task"."deleted_at" is null and "task"."archived_at" is not null)',
    );
    expect(render("include")).toBe('"task"."deleted_at" is null');
  });

  it("keeps visible tasks unarchived and out of triage", () => {
    const text = dialect.sqlToQuery(visibleTaskCondition).sql;
    expect(text).toContain('"task"."archived_at" is null');
    expect(text).toContain("'triage'");
    expect(text).not.toContain("'archived'");
  });
});
