import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { QueryContext } from "../../../apps/api/src/task-query/context";
import {
  DEFAULT_DIRECTIONS,
  orderByItems,
  orderFieldFromLegacySort,
  resolveOrder,
} from "../../../apps/api/src/task-query/order";
import { ORDER_BY_FIELDS } from "../../../apps/api/src/task-query/schema";

const dialect = new PgDialect();

function context(projectIds = ["project-1"]): QueryContext {
  return {
    workspaceId: "workspace-1",
    userId: "user-me",
    publicContext: false,
    timeZone: "UTC",
    weekStartsOn: 0,
    today: "2026-09-26",
    utcToday: "2026-09-26",
    projects: [],
    projectIds,
    projectById: new Map(),
    featureProjectIds: { cycles: projectIds, modules: [], estimates: [] },
    customFields: new Map(),
  };
}

describe("resolveOrder", () => {
  it("defaults to manual in project scope and newest first otherwise", () => {
    expect(resolveOrder(undefined, true)).toEqual({
      field: "manual",
      direction: "asc",
    });
    expect(resolveOrder(undefined, false)).toEqual({
      field: "createdAt",
      direction: "desc",
    });
  });

  it("uses each field's default direction unless one is given", () => {
    expect(resolveOrder({ field: "dueDate" }, true).direction).toBe("asc");
    expect(resolveOrder({ field: "priority" }, true).direction).toBe("desc");
    expect(resolveOrder({ field: "estimate" }, true).direction).toBe("desc");
    expect(
      resolveOrder({ field: "priority", direction: "asc" }, true).direction,
    ).toBe("asc");
  });

  it("has a default direction for every allow-listed field", () => {
    for (const field of ORDER_BY_FIELDS) {
      expect(DEFAULT_DIRECTIONS[field]).toMatch(/^(asc|desc)$/);
    }
  });
});

describe("orderFieldFromLegacySort", () => {
  it("maps the board's sort values", () => {
    expect(orderFieldFromLegacySort("position")).toBe("manual");
    expect(orderFieldFromLegacySort("createdAt")).toBe("createdAt");
    expect(orderFieldFromLegacySort("priority")).toBe("priority");
    expect(orderFieldFromLegacySort("dueDate")).toBe("dueDate");
    expect(orderFieldFromLegacySort("title")).toBe("title");
    expect(orderFieldFromLegacySort("number")).toBe("number");
    expect(orderFieldFromLegacySort("colour")).toBeNull();
  });
});

describe("orderByItems", () => {
  it("puts nulls last in both directions and breaks ties deterministically", () => {
    for (const direction of ["asc", "desc"] as const) {
      const text = dialect.sqlToQuery(
        orderByItems({ field: "dueDate", direction }, context()),
      ).sql;
      expect(text).toBe(
        `"task"."due_date" ${direction} nulls last, "task"."created_at" desc, "task"."id" asc`,
      );
    }
  });

  it("orders the manual order by position, then number", () => {
    const text = dialect.sqlToQuery(
      orderByItems({ field: "manual", direction: "asc" }, context()),
    ).sql;
    expect(text).toMatch(
      /^"task"\."position" asc nulls last, "task"\."number" asc nulls last,/,
    );
  });

  it("adds the project key to the number order across projects", () => {
    const single = dialect.sqlToQuery(
      orderByItems({ field: "number", direction: "asc" }, context()),
    ).sql;
    const several = dialect.sqlToQuery(
      orderByItems(
        { field: "number", direction: "asc" },
        context(["project-1", "project-2"]),
      ),
    ).sql;
    expect(single).not.toContain("order_project");
    expect(several).toContain("order_project");
  });

  it("builds every allow-listed order", () => {
    for (const field of ORDER_BY_FIELDS) {
      const text = dialect.sqlToQuery(
        orderByItems({ field, direction: "asc" }, context()),
      ).sql;
      expect(text).toContain('"task"."created_at" desc, "task"."id" asc');
    }
  });
});
