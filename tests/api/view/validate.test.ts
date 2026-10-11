import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  FilterKeyRegistry,
  filterKeyRegistry,
  type SetFilterKey,
} from "../../../apps/api/src/task-query/keys";
import { listBuiltInViews } from "../../../apps/api/src/view/built-in";
import {
  defaultViewDisplay,
  defaultViewDisplayProperties,
} from "../../../apps/api/src/view/normalize";
import { referencedIds } from "../../../apps/api/src/view/references";
import type { ViewFilters } from "../../../apps/api/src/view/types";
import {
  assertViewDisplay,
  assertViewDisplayProperties,
  assertViewFilters,
} from "../../../apps/api/src/view/validate";

function filters(root: ViewFilters["root"]): ViewFilters {
  return { version: 1, root, archived: "exclude" };
}

function messageOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof HTTPException)
      return `${error.status} ${error.message}`;
    throw error;
  }
}

const caller = { workspaceId: "workspace-1", userId: "user-me" };

describe("assertViewFilters", () => {
  it("runs the engine's validation", () => {
    const check = (root: ViewFilters["root"]) =>
      messageOf(() =>
        assertViewFilters(filters(root), { ...caller, scope: "project" }),
      );
    expect(check(null)).toBeNull();
    expect(
      check({ key: "priority", operator: "in", values: ["urgent", "none"] }),
    ).toBeNull();
    expect(check({ key: "weather", operator: "in", values: ["x"] })).toBe(
      "400 Unsupported filter: weather",
    );
    expect(check({ key: "priority", operator: "in", values: ["huge"] })).toBe(
      "400 Unsupported value for priority: huge",
    );
    expect(
      check({
        key: "dueDate",
        operator: "between",
        from: "2026-02-02",
        to: "2026-02-01",
      }),
    ).toBe("400 Invalid date range");
    expect(check({ op: "and", children: [] })).toContain(
      "400 Filters are too complex",
    );
  });

  it("refuses status filters in workspace views, at any depth", () => {
    const root = {
      op: "or" as const,
      children: [
        { key: "priority", operator: "in", values: ["high"] },
        { key: "status", operator: "in", values: ["to-do"] },
      ],
    };
    expect(
      messageOf(() =>
        assertViewFilters(filters(root), { ...caller, scope: "workspace" }),
      ),
    ).toBe("400 Workspace views can't filter by status; use group instead");
    expect(
      messageOf(() =>
        assertViewFilters(filters(root), { ...caller, scope: "project" }),
      ),
    ).toBeNull();
  });

  it("compiles the tree so each key's own checks run, with me as the caller", () => {
    const registry = new FilterKeyRegistry();
    const seen: string[][] = [];
    const ownOnly: SetFilterKey = {
      key: "watcher",
      kind: "set",
      tokens: ["me"],
      matchAny(values, context) {
        seen.push([...values]);
        if (values.some((value) => value !== context.userId)) {
          throw new HTTPException(400, { message: "Only your own" });
        }
        return sql`true`;
      },
      isEmpty: () => sql`false`,
    };
    registry.register(ownOnly);
    const check = (values: string[]) =>
      messageOf(() =>
        assertViewFilters(filters({ key: "watcher", operator: "in", values }), {
          ...caller,
          scope: "workspace",
          registry,
        }),
      );

    expect(check(["me"])).toBeNull();
    expect(seen).toEqual([["user-me"]]);
    expect(check(["someone-else"])).toBe("400 Only your own");
  });
});

describe("assertViewDisplay", () => {
  it("checks groups and the scope's layouts", () => {
    const check = (
      overrides: Partial<ReturnType<typeof defaultViewDisplay>>,
      scope: "project" | "workspace",
    ) =>
      messageOf(() =>
        assertViewDisplay(
          { ...defaultViewDisplay(scope), ...overrides },
          scope,
        ),
      );

    expect(check({}, "project")).toBeNull();
    expect(check({}, "workspace")).toBeNull();
    expect(check({ layout: "gantt" }, "project")).toBeNull();
    expect(check({ groupBy: "label", subGroupBy: "label" }, "project")).toBe(
      "400 Group and sub-group must differ",
    );
    expect(check({ groupBy: null, subGroupBy: "label" }, "workspace")).toBe(
      "400 Group and sub-group must differ",
    );
    expect(check({ groupBy: "status" }, "workspace")).toBe(
      "400 Group by status needs a single project",
    );
    expect(
      check({ groupBy: "priority", subGroupBy: "status" }, "workspace"),
    ).toBe("400 Group by status needs a single project");
    expect(check({ layout: "calendar" }, "workspace")).toBe(
      "400 Workspace views use the list, board or spreadsheet layout",
    );
  });

  it("keeps custom field columns to project views", () => {
    const properties = {
      ...defaultViewDisplayProperties(),
      customFields: ["field-1"],
    };
    expect(
      messageOf(() => assertViewDisplayProperties(properties, "project")),
    ).toBeNull();
    expect(
      messageOf(() => assertViewDisplayProperties(properties, "workspace")),
    ).toBe("400 Custom field columns need a project view");
  });
});

describe("referencedIds", () => {
  it("collects the ids conditions name, without tokens or literals", () => {
    const ids = referencedIds({
      op: "and",
      children: [
        { key: "assignee", operator: "in", values: ["me", "none", "u1"] },
        { key: "label", operator: "notIn", values: ["l1", "name:Bug"] },
        { key: "cycle", operator: "in", values: ["current", "c1"] },
        { key: "status", operator: "in", values: ["planned", "to-do"] },
        { key: "customField", operator: "in", values: ["x"], fieldId: "f1" },
        {
          op: "or",
          children: [
            { key: "assignee", operator: "notIn", values: ["u2", "u1"] },
            { key: "priority", operator: "in", values: ["high"] },
            { key: "dueDate", operator: "in", values: ["thisWeek"] },
          ],
        },
      ],
    });
    expect(Object.fromEntries(ids)).toEqual({
      assignee: ["u1", "u2"],
      label: ["l1"],
      cycle: ["c1"],
      status: ["to-do"],
      customField: ["f1"],
    });
    expect(referencedIds(null).size).toBe(0);
  });
});

describe("listBuiltInViews", () => {
  it("offers a built-in only once its filter keys are registered", () => {
    const withoutSubscriptions = new FilterKeyRegistry();
    for (const key of filterKeyRegistry.keys()) {
      const descriptor = filterKeyRegistry.get(key);
      if (descriptor && key !== "subscriber") {
        withoutSubscriptions.register(descriptor);
      }
    }
    expect(
      listBuiltInViews(withoutSubscriptions).map((view) => view.key),
    ).toEqual(["all", "assigned", "created"]);

    withoutSubscriptions.register({
      key: "subscriber",
      kind: "set",
      tokens: ["me"],
      matchAny: () => sql`true`,
      isEmpty: () => sql`false`,
    });
    const views = listBuiltInViews(withoutSubscriptions);
    expect(views.map((view) => view.key)).toEqual([
      "all",
      "assigned",
      "created",
      "subscribed",
    ]);
    expect(views[3]).toMatchObject({
      name: "Subscribed",
      baseFilter: { key: "subscriber", operator: "in", values: ["me"] },
      filters: { version: 1, root: null, archived: "exclude" },
      display: defaultViewDisplay("workspace"),
    });
  });
});
