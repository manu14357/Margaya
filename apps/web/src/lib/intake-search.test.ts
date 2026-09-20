import { describe, expect, it } from "vitest";
import type { IntakeCounts } from "@/types/intake";
import {
  hasActiveIntakeFilters,
  intakeEmptyKind,
  resolveIntakeFilters,
  toIntakeSearch,
  validateIntakeSearch,
} from "./intake-search";

const NO_COUNTS: IntakeCounts = {
  pending: 0,
  snoozed: 0,
  accepted: 0,
  declined: 0,
  duplicate: 0,
};

describe("validateIntakeSearch", () => {
  it("leaves defaults out of the URL", () => {
    expect(validateIntakeSearch({})).toEqual({
      tab: undefined,
      item: undefined,
      status: undefined,
      priority: undefined,
      submittedBy: undefined,
      q: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(
      validateIntakeSearch({
        tab: "open",
        status: ["pending"],
        sortBy: "createdAt",
        sortOrder: "desc",
      }),
    ).toMatchObject({
      tab: undefined,
      status: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
  });

  it("drops invalid values and statuses of the other tab", () => {
    expect(
      validateIntakeSearch({
        tab: "archive",
        status: "pending,accepted,bogus,snoozed",
        priority: ["urgent", "nope"],
        sortBy: "title",
        sortOrder: "sideways",
        q: "   ",
      }),
    ).toMatchObject({
      tab: undefined,
      status: ["pending", "snoozed"],
      priority: ["urgent"],
      sortBy: undefined,
      sortOrder: undefined,
      q: undefined,
    });
    expect(
      validateIntakeSearch({ tab: "closed", status: ["pending", "declined"] }),
    ).toMatchObject({ tab: "closed", status: ["declined"] });
  });

  it("keeps a selection, a submitter and a search", () => {
    expect(
      validateIntakeSearch({ item: "i1", submittedBy: "me", q: " safari " }),
    ).toMatchObject({ item: "i1", submittedBy: "me", q: "safari" });
  });
});

describe("resolveIntakeFilters", () => {
  it("fills the tab's default statuses and the default sort", () => {
    expect(resolveIntakeFilters({})).toEqual({
      tab: "open",
      statuses: ["pending"],
      priorities: [],
      submittedBy: undefined,
      q: undefined,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(resolveIntakeFilters({ tab: "closed" }).statuses).toEqual([
      "accepted",
      "declined",
      "duplicate",
    ]);
  });

  it("round-trips through the URL form", () => {
    const filters = resolveIntakeFilters({
      status: ["snoozed"],
      priority: ["low"],
      sortBy: "number",
      sortOrder: "asc",
    });
    expect(resolveIntakeFilters(toIntakeSearch(filters))).toEqual(filters);
  });
});

describe("intakeEmptyKind", () => {
  const open = resolveIntakeFilters({});

  it("says no requests yet, or all caught up", () => {
    expect(
      intakeEmptyKind({ filters: open, counts: NO_COUNTS, canReadAll: true }),
    ).toBe("noRequests");
    expect(
      intakeEmptyKind({
        filters: open,
        counts: { ...NO_COUNTS, accepted: 3 },
        canReadAll: true,
      }),
    ).toBe("caughtUp");
  });

  it("covers the closed tab, filters and requesters", () => {
    expect(
      intakeEmptyKind({
        filters: resolveIntakeFilters({ tab: "closed" }),
        counts: { ...NO_COUNTS, pending: 1 },
        canReadAll: true,
      }),
    ).toBe("noClosed");
    expect(
      intakeEmptyKind({
        filters: resolveIntakeFilters({ priority: ["urgent"] }),
        counts: NO_COUNTS,
        canReadAll: true,
      }),
    ).toBe("noMatches");
    expect(
      intakeEmptyKind({
        filters: resolveIntakeFilters({ q: "safari" }),
        counts: NO_COUNTS,
        canReadAll: false,
      }),
    ).toBe("noMatches");
    expect(
      intakeEmptyKind({ filters: open, counts: NO_COUNTS, canReadAll: false }),
    ).toBe("mine");
  });

  it("counts only non-default filters as active", () => {
    expect(hasActiveIntakeFilters(open)).toBe(false);
    expect(
      hasActiveIntakeFilters(resolveIntakeFilters({ status: ["snoozed"] })),
    ).toBe(true);
    expect(
      hasActiveIntakeFilters(resolveIntakeFilters({ submittedBy: "me" })),
    ).toBe(true);
  });
});
