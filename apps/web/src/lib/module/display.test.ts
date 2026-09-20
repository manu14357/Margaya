import { describe, expect, it } from "vitest";
import type { ModuleStatus } from "@/types/module";
import {
  DEFAULT_MODULE_DISPLAY,
  EMPTY_MODULE_FILTERS,
  filterModules,
  MODULE_LEAD_NONE,
  normalizeModuleDisplay,
  sortModules,
  toModuleOrder,
} from "./display";

type TestModule = {
  id: string;
  name: string;
  status: ModuleStatus;
  leadId: string | null;
  memberIds: string[];
  progress: number;
  counts: { total: number };
  targetDate: string | null;
  createdAt: string;
  position: number;
};

function module(overrides: Partial<TestModule> & { id: string }): TestModule {
  return {
    name: overrides.id,
    status: "backlog",
    leadId: null,
    memberIds: [],
    progress: 0,
    counts: { total: 0 },
    targetDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    position: 0,
    ...overrides,
  };
}

const ids = (modules: TestModule[]) => modules.map((entry) => entry.id);

describe("sortModules", () => {
  it("sorts names naturally, so Module 2 comes before Module 10", () => {
    const modules = [
      module({ id: "a", name: "Module 10" }),
      module({ id: "b", name: "module 2" }),
      module({ id: "c", name: "Module 1" }),
    ];
    expect(ids(sortModules(modules, "name"))).toEqual(["c", "b", "a"]);
    expect(ids(sortModules(modules, "-name"))).toEqual(["a", "b", "c"]);
  });

  it("puts modules without a target date last in both directions", () => {
    const modules = [
      module({ id: "none", targetDate: null }),
      module({ id: "late", targetDate: "2026-06-01" }),
      module({ id: "early", targetDate: "2026-02-01" }),
    ];
    expect(ids(sortModules(modules, "targetDate"))).toEqual([
      "early",
      "late",
      "none",
    ]);
    expect(ids(sortModules(modules, "-targetDate"))).toEqual([
      "late",
      "early",
      "none",
    ]);
  });

  it("orders by progress, task count, creation and position", () => {
    const modules = [
      module({
        id: "a",
        progress: 50,
        counts: { total: 1 },
        createdAt: "2026-03-01T00:00:00.000Z",
        position: 2,
      }),
      module({
        id: "b",
        progress: 10,
        counts: { total: 9 },
        createdAt: "2026-01-01T00:00:00.000Z",
        position: -1,
      }),
    ];
    expect(ids(sortModules(modules, "progress"))).toEqual(["b", "a"]);
    expect(ids(sortModules(modules, "-tasks"))).toEqual(["b", "a"]);
    expect(ids(sortModules(modules, "createdAt"))).toEqual(["b", "a"]);
    expect(ids(sortModules(modules, "manual"))).toEqual(["b", "a"]);
  });

  it("breaks ties by name, then id", () => {
    const modules = [
      module({ id: "2", name: "Same", progress: 5 }),
      module({ id: "1", name: "Same", progress: 5 }),
      module({ id: "0", name: "Alpha", progress: 5 }),
    ];
    expect(ids(sortModules(modules, "progress"))).toEqual(["0", "1", "2"]);
  });

  it("gives manual order no direction", () => {
    expect(toModuleOrder("manual", true)).toBe("manual");
    expect(toModuleOrder("name", true)).toBe("-name");
    expect(toModuleOrder("name", false)).toBe("name");
  });
});

describe("filterModules", () => {
  const modules = [
    module({
      id: "billing",
      name: "Billing v2",
      status: "in-progress",
      leadId: "ann",
      memberIds: ["bob"],
    }),
    module({ id: "onboarding", name: "Onboarding", status: "planned" }),
  ];

  it("keeps everything without filters or search", () => {
    expect(ids(filterModules(modules, EMPTY_MODULE_FILTERS))).toEqual([
      "billing",
      "onboarding",
    ]);
  });

  it("filters by status, lead (including no lead) and member", () => {
    const by = (filters: Partial<typeof EMPTY_MODULE_FILTERS>) =>
      ids(filterModules(modules, { ...EMPTY_MODULE_FILTERS, ...filters }));
    expect(by({ status: ["planned"] })).toEqual(["onboarding"]);
    expect(by({ lead: ["ann"] })).toEqual(["billing"]);
    expect(by({ lead: [MODULE_LEAD_NONE] })).toEqual(["onboarding"]);
    expect(by({ members: ["bob", "carl"] })).toEqual(["billing"]);
  });

  it("searches names case-insensitively", () => {
    expect(
      ids(filterModules(modules, EMPTY_MODULE_FILTERS, "  BILL ")),
    ).toEqual(["billing"]);
  });
});

describe("normalizeModuleDisplay", () => {
  it("falls back to the defaults for corrupt values", () => {
    expect(normalizeModuleDisplay(null)).toEqual(DEFAULT_MODULE_DISPLAY);
    expect(normalizeModuleDisplay("list")).toEqual(DEFAULT_MODULE_DISPLAY);
    expect(normalizeModuleDisplay([1, 2])).toEqual(DEFAULT_MODULE_DISPLAY);
    expect(
      normalizeModuleDisplay({
        layout: "carousel",
        groupByStatus: "yes",
        order: "-manual",
        filters: { status: ["done", "paused", 3], lead: "ann", members: [1] },
      }),
    ).toEqual({
      ...DEFAULT_MODULE_DISPLAY,
      filters: { status: ["paused"], lead: [], members: [] },
    });
  });

  it("keeps valid stored settings", () => {
    const stored = {
      layout: "gallery",
      groupByStatus: false,
      order: "-targetDate",
      filters: { status: ["completed"], lead: ["none"], members: ["bob"] },
    };
    expect(normalizeModuleDisplay(stored)).toEqual(stored);
  });
});
