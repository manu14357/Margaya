import { describe, expect, it } from "vitest";
import {
  inboxEmptyKind,
  resolveInboxFilters,
  toInboxSearch,
  validateInboxSearch,
} from "./inbox-search";

describe("inbox search params", () => {
  it("keeps valid values and drops defaults", () => {
    expect(
      validateInboxSearch({
        tab: "mentions",
        view: "archived",
        unread: true,
        types: ["subscribed", "assigned", "nope"],
        notificationId: "n1",
      }),
    ).toEqual({
      tab: "mentions",
      view: "archived",
      unread: true,
      types: ["assigned", "subscribed"],
      notificationId: "n1",
    });
    expect(validateInboxSearch({ tab: "all", view: "inbox" })).toEqual({
      tab: undefined,
      view: undefined,
      unread: undefined,
      types: undefined,
      notificationId: undefined,
    });
  });

  it("falls back to the defaults for invalid values", () => {
    const search = validateInboxSearch({
      tab: "everything",
      view: 3,
      unread: "yes",
      types: "created,bogus",
    });
    expect(resolveInboxFilters(search)).toEqual({
      tab: "all",
      view: "inbox",
      unread: false,
      types: ["created"],
    });
  });

  it("round-trips filters through the URL form", () => {
    const filters = {
      tab: "all" as const,
      view: "snoozed" as const,
      unread: false,
      types: [],
    };
    expect(resolveInboxFilters(toInboxSearch(filters))).toEqual(filters);
  });

  it("picks the empty state per tab, view and filter", () => {
    const base = resolveInboxFilters({});
    expect(inboxEmptyKind(base)).toBe("all");
    expect(inboxEmptyKind({ ...base, tab: "mentions" })).toBe("mentions");
    expect(inboxEmptyKind({ ...base, unread: true })).toBe("unread");
    expect(inboxEmptyKind({ ...base, view: "snoozed" })).toBe("snoozed");
    expect(inboxEmptyKind({ ...base, view: "archived" })).toBe("archived");
    expect(inboxEmptyKind({ ...base, types: ["assigned"] })).toBe("filtered");
  });
});
