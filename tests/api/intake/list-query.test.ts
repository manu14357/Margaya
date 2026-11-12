import { describe, expect, it } from "vitest";
import {
  classifySearch,
  resolvePriorityFilter,
  resolveStatusFilter,
  resolveSubmitterFilter,
  splitList,
} from "../../../apps/api/src/intake/list-filters";

describe("comma lists", () => {
  it("trims, drops blanks and dedupes", () => {
    expect(splitList(" high, low ,,high ")).toEqual(["high", "low"]);
    expect(splitList(undefined)).toEqual([]);
    expect(splitList("")).toEqual([]);
  });
});

describe("resolveStatusFilter", () => {
  it("defaults per tab", () => {
    expect(resolveStatusFilter("open", undefined)).toEqual(["pending"]);
    expect(resolveStatusFilter("closed", "")).toEqual([
      "accepted",
      "declined",
      "duplicate",
    ]);
  });

  it("keeps statuses of the tab", () => {
    expect(resolveStatusFilter("open", "snoozed, pending,snoozed")).toEqual([
      "snoozed",
      "pending",
    ]);
    expect(resolveStatusFilter("closed", "declined")).toEqual(["declined"]);
  });

  it("rejects cross-tab and unknown statuses", () => {
    expect(() => resolveStatusFilter("open", "accepted")).toThrow(
      "Status accepted doesn't belong to the open tab",
    );
    expect(() => resolveStatusFilter("closed", "pending")).toThrow(
      "Status pending doesn't belong to the closed tab",
    );
    expect(() => resolveStatusFilter("open", "archived")).toThrow(
      "Status archived doesn't belong to the open tab",
    );
  });
});

describe("resolvePriorityFilter", () => {
  it("accepts Margaya priorities and rejects others", () => {
    expect(resolvePriorityFilter("urgent, no-priority,urgent")).toEqual([
      "urgent",
      "no-priority",
    ]);
    expect(resolvePriorityFilter(undefined)).toEqual([]);
    expect(() => resolvePriorityFilter("urgent,critical")).toThrow(
      'Invalid priority "critical"',
    );
  });
});

describe("classifySearch", () => {
  it("classifies plain text, keys and numbers", () => {
    expect(classifySearch(undefined)).toEqual({ kind: "none" });
    expect(classifySearch("   ")).toEqual({ kind: "none" });
    expect(classifySearch(" login bug ")).toEqual({
      kind: "text",
      text: "login bug",
    });
    expect(classifySearch("web-12")).toEqual({
      kind: "key",
      text: "web-12",
      slug: "web",
      number: 12,
    });
    expect(classifySearch("WEB-12")).toMatchObject({
      kind: "key",
      slug: "WEB",
      number: 12,
    });
    expect(classifySearch("42")).toEqual({
      kind: "number",
      text: "42",
      number: 42,
    });
    // Out of range numbers only search the title.
    expect(classifySearch("99999999999")).toEqual({
      kind: "text",
      text: "99999999999",
    });
    expect(classifySearch("0")).toEqual({ kind: "text", text: "0" });
  });
});

describe("resolveSubmitterFilter", () => {
  it("lets readers filter by anyone, `me` meaning the caller", () => {
    expect(resolveSubmitterFilter(undefined, "u1", false)).toEqual({
      kind: "any",
    });
    expect(resolveSubmitterFilter("me", "u1", false)).toEqual({
      kind: "user",
      userId: "u1",
    });
    expect(resolveSubmitterFilter("u2", "u1", false)).toEqual({
      kind: "user",
      userId: "u2",
    });
  });

  it("limits own-only callers to themselves", () => {
    expect(resolveSubmitterFilter(undefined, "u1", true)).toEqual({
      kind: "user",
      userId: "u1",
    });
    expect(resolveSubmitterFilter("me", "u1", true)).toEqual({
      kind: "user",
      userId: "u1",
    });
    expect(resolveSubmitterFilter("u2", "u1", true)).toEqual({
      kind: "nobody",
    });
  });
});

describe("resolveSourceFilter (#8)", () => {
  it("accepts known sources, email and form included", async () => {
    const { resolveSourceFilter } = await import(
      "../../../apps/api/src/intake/list-filters"
    );
    expect(resolveSourceFilter(undefined)).toEqual([]);
    expect(resolveSourceFilter("email, form,email")).toEqual(["email", "form"]);
    expect(() => resolveSourceFilter("fax")).toThrow(/Invalid source/);
  });
});
