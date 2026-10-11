import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  defaultViewDisplay,
  defaultViewDisplayProperties,
  mergeViewDisplay,
  mergeViewDisplayProperties,
  mergeViewFilters,
  readViewDisplay,
  readViewDisplayProperties,
  readViewFilters,
  sameJson,
} from "../../../apps/api/src/view/normalize";
import {
  viewDisplayInputSchema,
  viewDisplayPropertiesInputSchema,
  viewFiltersInputSchema,
} from "../../../apps/api/src/view/schema";

describe("view defaults", () => {
  it("differ per scope", () => {
    expect(defaultViewDisplay("project")).toEqual({
      layout: "list",
      groupBy: "status",
      subGroupBy: null,
      orderBy: { field: "manual", direction: "asc" },
      showSubTasks: true,
      showEmptyGroups: false,
    });
    expect(defaultViewDisplay("workspace")).toMatchObject({
      layout: "spreadsheet",
      groupBy: null,
      orderBy: { field: "createdAt", direction: "desc" },
    });
  });

  it("shows the usual properties and hides dates, counts and reserved ones", () => {
    const properties = defaultViewDisplayProperties();
    const off = Object.entries(properties)
      .filter(([, value]) => value === false)
      .map(([key]) => key);
    expect(off).toEqual([
      "startDate",
      "createdAt",
      "updatedAt",
      "linkCount",
      "attachmentCount",
    ]);
    expect(properties.customFields).toEqual([]);
  });
});

describe("reading stored views", () => {
  it("drops unknown keys and values, and defaults what is missing", () => {
    expect(
      readViewDisplay(
        {
          layout: "timeline",
          groupBy: "priority",
          subGroupBy: "priority",
          orderBy: { field: "dueDate", direction: "sideways" },
          showEmptyGroups: true,
          legacy: 1,
        },
        "project",
      ),
    ).toEqual({
      layout: "list",
      groupBy: "priority",
      subGroupBy: null,
      orderBy: { field: "dueDate", direction: "asc" },
      showSubTasks: true,
      showEmptyGroups: true,
    });
    expect(readViewDisplay({ groupBy: null }, "project").groupBy).toBeNull();
    expect(readViewDisplay(null, "workspace")).toEqual(
      defaultViewDisplay("workspace"),
    );

    expect(
      readViewDisplayProperties({
        key: false,
        linkCount: "yes",
        mystery: true,
        customFields: ["a", "a", 3, "b"],
      }),
    ).toEqual({
      ...defaultViewDisplayProperties(),
      key: false,
      customFields: ["a", "b"],
    });

    const root = { key: "priority", operator: "in", values: ["high"] };
    expect(readViewFilters({ root, archived: "only", search: "x" })).toEqual({
      version: 1,
      root,
      archived: "only",
    });
    expect(readViewFilters({ root: {}, archived: "sometimes" })).toEqual({
      version: 1,
      root: null,
      archived: "exclude",
    });
  });
});

describe("merging partial input", () => {
  it("keeps what the input leaves out", () => {
    const root = { key: "priority", operator: "in", values: ["high"] };
    const filters = { version: 1 as const, root, archived: "exclude" as const };
    expect(mergeViewFilters(filters, { archived: "include" })).toEqual({
      ...filters,
      archived: "include",
    });
    expect(mergeViewFilters(filters, { root: null }).root).toBeNull();
    expect(mergeViewFilters(filters, undefined)).toEqual(filters);

    const display = {
      ...defaultViewDisplay("project"),
      groupBy: "priority" as const,
      subGroupBy: "assignee" as const,
    };
    expect(mergeViewDisplay(display, { layout: "board" })).toMatchObject({
      layout: "board",
      groupBy: "priority",
      subGroupBy: "assignee",
    });
    // A stored sub-group that no longer fits is dropped; a sent one is kept
    // for validation to judge.
    expect(mergeViewDisplay(display, { groupBy: "assignee" }).subGroupBy).toBe(
      null,
    );
    expect(mergeViewDisplay(display, { groupBy: null }).subGroupBy).toBe(null);
    expect(
      mergeViewDisplay(display, { groupBy: "label", subGroupBy: "label" })
        .subGroupBy,
    ).toBe("label");
    expect(
      mergeViewDisplay(display, { orderBy: { field: "priority" } }).orderBy,
    ).toEqual({ field: "priority", direction: "desc" });

    const properties = mergeViewDisplayProperties(
      defaultViewDisplayProperties(),
      { startDate: true, customFields: ["f1", "f1", "f2"] },
    );
    expect(properties).toMatchObject({
      startDate: true,
      key: true,
      customFields: ["f1", "f2"],
    });
  });
});

describe("input schemas", () => {
  it("reject unknown keys on write", () => {
    expect(
      viewDisplayPropertiesInputSchema.safeParse({ mystery: true }).success,
    ).toBe(false);
    expect(viewDisplayInputSchema.safeParse({ zoom: 2 }).success).toBe(false);
    expect(
      viewFiltersInputSchema.safeParse({ root: null, search: "x" }).success,
    ).toBe(false);
    expect(viewFiltersInputSchema.safeParse({ version: 2 }).success).toBe(
      false,
    );
    expect(
      viewDisplayInputSchema.safeParse({ layout: "timeline" }).success,
    ).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("ignores object key order but not array order", () => {
    expect(
      sameJson(
        { op: "and", children: [{ key: "a", values: ["x", "y"] }] },
        { children: [{ values: ["x", "y"], key: "a" }], op: "and" },
      ),
    ).toBe(true);
    expect(sameJson({ values: ["x", "y"] }, { values: ["y", "x"] })).toBe(
      false,
    );
    expect(canonicalJson({ b: 1, a: undefined, c: null })).toBe(
      '{"b":1,"c":null}',
    );
  });
});
