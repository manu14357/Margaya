import { describe, expect, it } from "vitest";
import {
  canonicalizeEstimateValue,
  sortPointsForType,
  validateEstimateValue,
  validateEstimateValues,
} from "./values";

function codeOf(
  type: Parameters<typeof canonicalizeEstimateValue>[0],
  raw: string,
) {
  const result = canonicalizeEstimateValue(type, raw);
  return result.ok ? null : result.code;
}

describe("canonicalizeEstimateValue", () => {
  it.each([
    ["0", "not_positive"],
    ["-1", "not_positive"],
    ["abc", "not_numeric"],
    ["1,5", "not_numeric"],
    ["1e3", "not_numeric"],
    ["1000", "too_large"],
    ["1.234", "too_precise"],
    ["", "empty"],
    ["   ", "empty"],
    ["123456789012345678901", "too_long"],
  ])("rejects %j as points with %s", (raw, code) => {
    expect(codeOf("points", raw)).toBe(code);
  });

  it("stores points as their shortest decimal", () => {
    expect(canonicalizeEstimateValue("points", "05")).toEqual({
      ok: true,
      point: { value: "5", numericValue: 5 },
    });
    expect(canonicalizeEstimateValue("points", " 2.50 ")).toEqual({
      ok: true,
      point: { value: "2.5", numericValue: 2.5 },
    });
    expect(canonicalizeEstimateValue("points", "3.0")).toEqual({
      ok: true,
      point: { value: "3", numericValue: 3 },
    });
  });

  it("ignores trailing zeros when counting decimals", () => {
    expect(codeOf("points", "2.500")).toBeNull();
    expect(codeOf("points", "0.25")).toBeNull();
    expect(codeOf("points", "999")).toBeNull();
  });

  it("takes whole minutes up to 60000 for time", () => {
    expect(canonicalizeEstimateValue("time", "90")).toEqual({
      ok: true,
      point: { value: "90", numericValue: 90 },
    });
    expect(codeOf("time", "0")).toBe("not_positive");
    expect(codeOf("time", "1.5")).toBe("too_precise");
    expect(codeOf("time", "60001")).toBe("too_large");
    expect(codeOf("time", "1h")).toBe("not_numeric");
  });

  it("rejects plain numbers as categories and collapses whitespace", () => {
    expect(codeOf("categories", "3")).toBe("numeric_category");
    expect(codeOf("categories", "2.5")).toBe("numeric_category");
    expect(canonicalizeEstimateValue("categories", "  Very   hard ")).toEqual({
      ok: true,
      point: { value: "Very hard", numericValue: null },
    });
    // Not a plain decimal, so it is text.
    expect(codeOf("categories", "1,5")).toBeNull();
  });
});

describe("validateEstimateValues", () => {
  it("accepts a template", () => {
    expect(
      validateEstimateValues("points", ["1", "2", "3", "5", "8", "13"]),
    ).toEqual({ ok: true, errors: [] });
  });

  it("reports numeric duplicates at the later copy", () => {
    expect(validateEstimateValues("points", ["5", "5.0", "8"])).toEqual({
      ok: false,
      errors: [{ index: 1, code: "duplicate" }],
    });
  });

  it("compares categories ignoring case and extra spaces", () => {
    expect(validateEstimateValues("categories", ["m", "M"]).errors).toEqual([
      { index: 1, code: "duplicate" },
    ]);
    expect(
      validateEstimateValues("categories", ["Very  hard", "very hard"]).errors,
    ).toEqual([{ index: 1, code: "duplicate" }]);
  });

  it("checks every value and the count, with index -1 for the count", () => {
    expect(validateEstimateValues("points", ["abc"]).errors).toEqual([
      { index: 0, code: "not_numeric" },
      { index: -1, code: "too_few" },
    ]);
    const eleven = Array.from({ length: 11 }, (_, index) => String(index + 1));
    expect(validateEstimateValues("points", eleven).errors).toEqual([
      { index: -1, code: "too_many" },
    ]);
  });
});

describe("validateEstimateValue", () => {
  const others = [
    { value: "3", numericValue: 3 },
    { value: "5", numericValue: 5 },
  ];

  it("rejects a value equal to another one", () => {
    expect(validateEstimateValue("points", "5.00", others)).toEqual({
      ok: false,
      code: "duplicate",
    });
  });

  it("returns the canonical form otherwise", () => {
    expect(validateEstimateValue("points", "08", others)).toEqual({
      ok: true,
      point: { value: "8", numericValue: 8 },
    });
  });
});

describe("sortPointsForType", () => {
  it("orders numeric systems by value and renumbers positions", () => {
    const sorted = sortPointsForType("points", [
      { id: "b", numericValue: 8 },
      { id: "a", numericValue: 2 },
    ]);
    expect(sorted).toEqual([
      { id: "a", numericValue: 2, position: 1 },
      { id: "b", numericValue: 8, position: 2 },
    ]);
  });

  it("keeps the given order for categories", () => {
    const sorted = sortPointsForType("categories", [
      { id: "l", numericValue: null },
      { id: "s", numericValue: null },
    ]);
    expect(sorted.map((point) => [point.id, point.position])).toEqual([
      ["l", 1],
      ["s", 2],
    ]);
  });
});
