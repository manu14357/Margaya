import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  compileFilterTree,
  searchCondition,
} from "../../../apps/api/src/task-query/compile";
import type { QueryContext } from "../../../apps/api/src/task-query/context";
import {
  FilterKeyRegistry,
  filterKeyRegistry,
  type SetFilterKey,
} from "../../../apps/api/src/task-query/keys";
import type {
  FilterCondition,
  FilterNode,
} from "../../../apps/api/src/task-query/schema";
import { validateFilterTree } from "../../../apps/api/src/task-query/validate";

const dialect = new PgDialect();

function render(expression: SQL | undefined) {
  if (!expression) throw new Error("expected SQL");
  return dialect.sqlToQuery(expression);
}

function context(overrides: Partial<QueryContext> = {}): QueryContext {
  return {
    workspaceId: "workspace-1",
    userId: "user-me",
    publicContext: false,
    timeZone: "UTC",
    weekStartsOn: 0,
    today: "2026-09-26",
    utcToday: "2026-09-26",
    projects: [],
    projectIds: ["project-1"],
    projectById: new Map(),
    featureProjectIds: {
      cycles: ["project-1"],
      modules: ["project-1"],
      estimates: ["project-1"],
    },
    customFields: new Map(),
    ...overrides,
  };
}

/** A key whose SQL is a constant decided by a fixed task value set. */
function registryFor(taskValues: readonly string[]) {
  const registry = new FilterKeyRegistry();
  const key: SetFilterKey = {
    key: "tag",
    kind: "set",
    matchAny: (values) =>
      values.some((value) => taskValues.includes(value))
        ? sql`true`
        : sql`false`,
    isEmpty: () => (taskValues.length === 0 ? sql`true` : sql`false`),
  };
  registry.register(key);
  return registry;
}

/** Evaluates a condition built from true/false constants. */
function evaluate(expression: SQL | undefined): boolean {
  const js = render(expression)
    .sql.replace(/\bnot\b/g, "!")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||");
  return Function(`return (${js});`)() as boolean;
}

function matches(
  operator: "in" | "notIn",
  values: string[],
  taskValues: string[],
) {
  const condition: FilterCondition = { key: "tag", operator, values };
  return evaluate(
    compileFilterTree(condition, context(), registryFor(taskValues)),
  );
}

function expectBadRequest(run: () => unknown, message: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(400);
    expect((error as HTTPException).message).toBe(message);
    return;
  }
  throw new Error(`expected a 400: ${message}`);
}

describe("set semantics (B4 §2.4)", () => {
  it.each([
    ["in", ["a"], ["a", "b"], true],
    ["in", ["a"], ["b"], false],
    ["in", ["a"], [], false],
    ["in", ["a", "none"], [], true],
    ["in", ["a", "none"], ["b"], false],
    ["in", ["a", "none"], ["a"], true],
    ["in", ["none"], [], true],
    ["in", ["none"], ["a"], false],
    ["notIn", ["a"], [], true],
    ["notIn", ["a"], ["b"], true],
    ["notIn", ["a"], ["a", "b"], false],
    ["notIn", ["a", "none"], [], false],
    ["notIn", ["a", "none"], ["b"], true],
    ["notIn", ["a", "none"], ["a"], false],
    ["notIn", ["none"], [], false],
    ["notIn", ["none"], ["a"], true],
  ] as const)(
    "%s %j with values %j is %s",
    (operator, values, task, expected) => {
      expect(matches(operator, [...values], [...task])).toBe(expected);
    },
  );
});

describe("compileFilterTree", () => {
  it("maps groups to parenthesized and / or", () => {
    const tree: FilterNode = {
      op: "or",
      children: [
        { key: "priority", operator: "in", values: ["high"] },
        {
          op: "and",
          children: [
            { key: "status", operator: "in", values: ["to-do"] },
            { key: "project", operator: "notIn", values: ["project-2"] },
          ],
        },
      ],
    };
    const { sql: text, params } = render(compileFilterTree(tree, context()));
    expect(text).toMatch(/^\(.* or \(.* and not .*\)\)$/);
    expect(params).toEqual(["high", "to-do", "project-2"]);
  });

  it("replaces me with the caller, once", () => {
    const seen: string[][] = [];
    const registry = new FilterKeyRegistry();
    registry.register({
      key: "person",
      kind: "set",
      tokens: ["me"],
      matchAny: (values) => {
        seen.push([...values]);
        return sql`true`;
      },
      isEmpty: () => sql`false`,
    });
    compileFilterTree(
      { key: "person", operator: "in", values: ["me", "user-me", "user-2"] },
      context(),
      registry,
    );
    expect(seen).toEqual([["user-me", "user-2"]]);
  });

  it("refuses me and personal keys in a public context", () => {
    expectBadRequest(
      () =>
        compileFilterTree(
          { key: "assignee", operator: "in", values: ["me"] },
          context({ publicContext: true }),
        ),
      "Unsupported value for assignee: me",
    );
    expectBadRequest(
      () =>
        compileFilterTree(
          { key: "createdBy", operator: "in", values: ["user-2"] },
          context({ publicContext: true }),
        ),
      "Unsupported filter: createdBy",
    );
  });

  it("compares date conditions with zoned day bounds", () => {
    const { params } = render(
      compileFilterTree(
        { key: "dueDate", operator: "on", date: "2026-09-26" },
        context({ timeZone: "Asia/Kolkata" }),
      ),
    );
    expect(params).toEqual([
      "2026-09-25T18:30:00.000Z",
      "2026-09-26T18:30:00.000Z",
    ]);
  });

  it("ORs date presets and treats none as unset", () => {
    const { sql: text } = render(
      compileFilterTree(
        { key: "dueDate", operator: "in", values: ["past", "none"] },
        context(),
      ),
    );
    expect(text).toContain(" or ");
    expect(text).toContain('"task"."due_date" is null');
  });
});

describe("searchCondition", () => {
  const ctx = context({
    projects: [
      {
        id: "project-1",
        name: "Web",
        slug: "web",
        icon: null,
        position: 0,
        createdAt: new Date(),
        archivedAt: null,
        cyclesEnabled: true,
        modulesEnabled: true,
        estimatesEnabled: false,
        columns: [],
      },
    ],
  });

  it("matches a task key in a scope project", () => {
    const { params } = render(searchCondition("WEB-12", ctx));
    expect(params).toContain(12);
    expect(params).toContainEqual(["project-1"]);
  });

  it("matches a number or the title for #12 and 12", () => {
    expect(render(searchCondition("#12", ctx)).params).toEqual([12, "%#12%"]);
    expect(render(searchCondition("12", ctx)).params).toEqual([12, "%12%"]);
  });

  it("escapes LIKE wildcards", () => {
    expect(render(searchCondition("50%_off", ctx)).params).toEqual([
      "%50\\%\\_off%",
    ]);
    expect(searchCondition("   ", ctx)).toBeUndefined();
  });
});

describe("validateFilterTree", () => {
  const condition = (): FilterCondition => ({
    key: "priority",
    operator: "in",
    values: ["high"],
  });
  const nest = (depth: number): FilterNode =>
    depth === 0 ? condition() : { op: "and", children: [nest(depth - 1)] };

  it("accepts three levels of groups and refuses four", () => {
    expect(() => validateFilterTree(nest(3))).not.toThrow();
    expectBadRequest(
      () => validateFilterTree(nest(4)),
      "Filters are too complex: groups nest deeper than 3 levels",
    );
  });

  it("limits conditions, children, values and value length", () => {
    const many = (count: number): FilterNode => ({
      op: "and",
      children: Array.from({ length: Math.ceil(count / 20) }, (_, group) => ({
        op: "or" as const,
        children: Array.from(
          { length: Math.min(20, count - group * 20) },
          condition,
        ),
      })),
    });
    expect(() => validateFilterTree(many(50))).not.toThrow();
    expectBadRequest(
      () => validateFilterTree(many(51)),
      "Filters are too complex: more than 50 conditions",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          op: "and",
          children: Array.from({ length: 21 }, condition),
        }),
      "Filters are too complex: a group needs 1 to 20 filters",
    );
    expectBadRequest(
      () => validateFilterTree({ op: "and", children: [] }),
      "Filters are too complex: a group needs 1 to 20 filters",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "assignee",
          operator: "in",
          values: Array.from({ length: 101 }, (_, i) => `user-${i}`),
        }),
      "Filters are too complex: a condition has more than 100 values",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "assignee",
          operator: "in",
          values: ["x".repeat(129)],
        }),
      "Filters are too complex: a value is longer than 128 characters",
    );
  });

  it("refuses unknown and reserved keys", () => {
    expectBadRequest(
      () =>
        validateFilterTree({ key: "colour", operator: "in", values: ["x"] }),
      "Unsupported filter: colour",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "subscriber",
          operator: "in",
          values: ["me"],
        }),
      "Unsupported filter: subscriber",
    );
  });

  it("checks each operator's fields", () => {
    expectBadRequest(
      () =>
        validateFilterTree({ key: "priority", operator: "on", values: ["x"] }),
      "Operator on is not valid for priority",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "priority",
          operator: "in",
          values: ["high"],
          date: "2026-09-26",
        }),
      "Operator in is not valid for priority",
    );
    expectBadRequest(
      () => validateFilterTree({ key: "dueDate", operator: "between" }),
      "Operator between is not valid for dueDate",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "customField",
          operator: "in",
          values: ["a"],
        }),
      "Operator in is not valid for customField",
    );
    expect(() =>
      validateFilterTree({
        key: "customField",
        operator: "in",
        values: ["a"],
        fieldId: "field-1",
      }),
    ).not.toThrow();
  });

  it("checks closed values, presets, dates and amounts", () => {
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "priority",
          operator: "in",
          values: ["highest"],
        }),
      "Unsupported value for priority: highest",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "dueDate",
          operator: "in",
          values: ["someday"],
        }),
      "Unsupported value for dueDate: someday",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "dueDate",
          operator: "on",
          date: "2026-02-30",
        }),
      "Invalid date",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "dueDate",
          operator: "between",
          from: "2026-10-01",
          to: "2026-09-01",
        }),
      "Invalid date range",
    );
    expectBadRequest(
      () =>
        validateFilterTree({
          key: "dueDate",
          operator: "withinLast",
          amount: 366,
          unit: "days",
        }),
      "Invalid amount for dueDate: use 1 to 365",
    );
  });

  it("uses the engine registry by default", () => {
    expect(filterKeyRegistry.keys()).toEqual(
      expect.arrayContaining([
        "status",
        "group",
        "priority",
        "assignee",
        "createdBy",
        "label",
        "cycle",
        "module",
        "estimate",
        "project",
        "parent",
        "customField",
        "startDate",
        "dueDate",
        "createdAt",
        "updatedAt",
        "completedAt",
      ]),
    );
    expect(filterKeyRegistry.has("subscriber")).toBe(false);
  });
});
