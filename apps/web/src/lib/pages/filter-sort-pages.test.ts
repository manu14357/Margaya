import { describe, expect, it } from "vitest";
import {
  countPagesByTab,
  type FilterablePage,
  filterPages,
  hasPageChipFilters,
  hasPageFilters,
  isCreatedWithin,
  isPageListTab,
  isPageSort,
  sortPages,
} from "./filter-sort-pages";

function page(id: string, extra: Partial<FilterablePage> = {}): FilterablePage {
  return {
    id,
    title: id,
    access: "public",
    ownerId: "u1",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

const base = { query: "", ownerIds: [], untitledLabel: "Untitled" };

describe("filterPages", () => {
  const pages = [
    page("Spec"),
    page("", { id: "empty" }),
    page("Mine", { access: "private" }),
    page("Old", { archivedAt: "2026-02-01T00:00:00Z", access: "private" }),
    page("Theirs", { ownerId: "u2" }),
  ];

  it("splits pages into the three tabs", () => {
    const ids = (tab: "public" | "private" | "archived") =>
      filterPages(pages, { ...base, tab }).map((item) => item.id);
    expect(ids("public")).toEqual(["Spec", "empty", "Theirs"]);
    expect(ids("private")).toEqual(["Mine"]);
    expect(ids("archived")).toEqual(["Old"]);
    expect(countPagesByTab(pages)).toEqual({
      public: 3,
      private: 1,
      archived: 1,
    });
  });

  it("matches an empty title as Untitled, case-insensitively", () => {
    const found = filterPages(pages, { ...base, tab: "public", query: "UNTI" });
    expect(found.map((item) => item.id)).toEqual(["empty"]);
  });

  it("keeps pages of any selected owner", () => {
    const found = filterPages(pages, {
      ...base,
      tab: "public",
      ownerIds: ["u2"],
    });
    expect(found.map((item) => item.id)).toEqual(["Theirs"]);
    expect(hasPageFilters({ query: " ", ownerIds: [] })).toBe(false);
    expect(hasPageFilters({ query: "", ownerIds: ["u2"] })).toBe(true);
  });
});

describe("sortPages", () => {
  const pages = [
    page("b", {
      title: "beta",
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    }),
    page("a", {
      title: "Alpha",
      createdAt: "2026-01-03T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
    }),
    page("c", {
      title: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    }),
  ];
  const ids = (sort: Parameters<typeof sortPages>[1]) =>
    sortPages(pages, sort, "Untitled").map((item) => item.id);

  it("sorts by last edited, newest first by default", () => {
    expect(ids({ field: "updatedAt", direction: "desc" })).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(ids({ field: "updatedAt", direction: "asc" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts by creation date", () => {
    expect(ids({ field: "createdAt", direction: "asc" })).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("sorts names case-insensitively, Untitled for empty titles", () => {
    expect(ids({ field: "title", direction: "asc" })).toEqual(["a", "b", "c"]);
    expect(ids({ field: "title", direction: "desc" })).toEqual(["c", "b", "a"]);
  });

  it("validates stored sorts and tabs", () => {
    expect(isPageSort({ field: "title", direction: "asc" })).toBe(true);
    expect(isPageSort({ field: "priority", direction: "asc" })).toBe(false);
    expect(isPageListTab("archived")).toBe(true);
    expect(isPageListTab("trash")).toBe(false);
  });
});

describe("favorites and created-date filters", () => {
  // Local time on purpose: "today" starts at the viewer's midnight.
  const now = new Date(2026, 9, 20, 9, 30);
  const at = (days: number, hours = 0) =>
    new Date(
      now.getTime() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000,
    );

  it("keeps only favorites once they are known", () => {
    const pages = [page("a"), page("b"), page("c")];
    const filters = { ...base, tab: "public" as const, favoritesOnly: true };
    expect(
      filterPages(pages, { ...filters, favoriteIds: new Set(["b"]) }).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    // Until the favorites load, the filter waits instead of hiding all.
    expect(filterPages(pages, filters)).toHaveLength(3);
  });

  it("counts today from local midnight", () => {
    const midnight = new Date(2026, 9, 20, 0, 0);
    const justBefore = new Date(midnight.getTime() - 1);
    expect(isCreatedWithin(midnight, "today", now)).toBe(true);
    expect(isCreatedWithin(justBefore, "today", now)).toBe(false);
    expect(isCreatedWithin(justBefore.toISOString(), "today", now)).toBe(false);
  });

  it("uses rolling 7 and 30 day windows, and older beyond 30", () => {
    expect(isCreatedWithin(at(7), "last7", now)).toBe(true);
    expect(isCreatedWithin(at(7, 1), "last7", now)).toBe(false);
    expect(isCreatedWithin(at(30), "last30", now)).toBe(true);
    expect(isCreatedWithin(at(30, 1), "last30", now)).toBe(false);
    expect(isCreatedWithin(at(30), "older", now)).toBe(false);
    expect(isCreatedWithin(at(30, 1), "older", now)).toBe(true);
    expect(isCreatedWithin(at(400), "any", now)).toBe(true);
  });

  it("filters the list by the created window", () => {
    const pages = [
      page("new", { createdAt: at(0, 1).toISOString() }),
      page("week", { createdAt: at(5).toISOString() }),
      page("old", { createdAt: at(60).toISOString() }),
    ];
    const ids = (createdWithin: "today" | "last7" | "older") =>
      filterPages(pages, { ...base, tab: "public", createdWithin, now }).map(
        (item) => item.id,
      );
    expect(ids("today")).toEqual(["new"]);
    expect(ids("last7")).toEqual(["new", "week"]);
    expect(ids("older")).toEqual(["old"]);
  });

  it("reports chip filters apart from the search text", () => {
    expect(hasPageChipFilters({ ownerIds: [] })).toBe(false);
    expect(hasPageChipFilters({ ownerIds: [], favoritesOnly: true })).toBe(
      true,
    );
    expect(hasPageChipFilters({ ownerIds: [], createdWithin: "last30" })).toBe(
      true,
    );
    expect(
      hasPageFilters({ query: "", ownerIds: [], createdWithin: "any" }),
    ).toBe(false);
  });
});
