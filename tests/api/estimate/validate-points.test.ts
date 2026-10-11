import { describe, expect, it } from "vitest";
import {
  canonicalizeEstimateValue,
  estimateValueKey,
  validateEstimateValue,
  validateEstimateValues,
} from "../../../apps/api/src/estimate/validate-points";

function codeOf(
  type: Parameters<typeof canonicalizeEstimateValue>[0],
  raw: string,
) {
  const result = canonicalizeEstimateValue(type, raw);
  return result.ok ? null : result.code;
}

function canonical(
  type: Parameters<typeof canonicalizeEstimateValue>[0],
  raw: string,
) {
  const result = canonicalizeEstimateValue(type, raw);
  if (!result.ok) throw new Error(`expected ${raw} to be valid`);
  return result.point;
}

describe("points values", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["123456789012345678901", "too_long"],
    ["abc", "not_numeric"],
    ["1,5", "not_numeric"],
    ["1e3", "not_numeric"],
    ["0", "not_positive"],
    ["-1", "not_positive"],
    ["0.00", "not_positive"],
    ["1000", "too_large"],
    ["999.01", "too_large"],
    ["1.234", "too_precise"],
    ["0.001", "too_precise"],
  ])("%j breaks the %s rule", (raw, code) => {
    expect(codeOf("points", raw)).toBe(code);
  });

  it("stores the shortest decimal text next to the number", () => {
    expect(canonical("points", "05")).toEqual({ value: "5", numericValue: 5 });
    expect(canonical("points", "2.50")).toEqual({
      value: "2.5",
      numericValue: 2.5,
    });
    expect(canonical("points", " 3.0 ")).toEqual({
      value: "3",
      numericValue: 3,
    });
    expect(canonical("points", ".25")).toEqual({
      value: "0.25",
      numericValue: 0.25,
    });
    expect(canonical("points", "999")).toEqual({
      value: "999",
      numericValue: 999,
    });
  });

  it("counts decimals without trailing zeros", () => {
    expect(canonical("points", "1.230")).toEqual({
      value: "1.23",
      numericValue: 1.23,
    });
  });
});

describe("time values", () => {
  it.each([
    ["", "empty"],
    ["1h", "not_numeric"],
    ["0", "not_positive"],
    ["-30", "not_positive"],
    ["60001", "too_large"],
    ["90.5", "too_precise"],
  ])("%j breaks the %s rule", (raw, code) => {
    expect(codeOf("time", raw)).toBe(code);
  });

  it("stores whole minutes as an integer string", () => {
    expect(canonical("time", "090")).toEqual({
      value: "90",
      numericValue: 90,
    });
    expect(canonical("time", "60000")).toEqual({
      value: "60000",
      numericValue: 60000,
    });
    expect(canonical("time", "45.0")).toEqual({
      value: "45",
      numericValue: 45,
    });
  });
});

describe("category values", () => {
  it.each([
    ["", "empty"],
    ["3", "numeric_category"],
    [" 2.5 ", "numeric_category"],
    ["a".repeat(21), "too_long"],
  ])("%j breaks the %s rule", (raw, code) => {
    expect(codeOf("categories", raw)).toBe(code);
  });

  it("collapses inner whitespace and keeps the case", () => {
    expect(canonical("categories", "  Very   hard ")).toEqual({
      value: "Very hard",
      numericValue: null,
    });
    expect(canonical("categories", "XL")).toEqual({
      value: "XL",
      numericValue: null,
    });
  });

  it("measures length after trimming and before collapsing", () => {
    expect(codeOf("categories", `  ${"a".repeat(20)}  `)).toBeNull();
    expect(codeOf("categories", `a${" ".repeat(19)}b`)).toBe("too_long");
  });

  it("accepts text that is not a plain decimal", () => {
    expect(canonical("categories", "1,5").value).toBe("1,5");
    expect(canonical("categories", "1e3").value).toBe("1e3");
  });
});

describe("value keys", () => {
  it("compare numbers by value and categories without case", () => {
    expect(estimateValueKey(canonical("points", "5"))).toBe(
      estimateValueKey(canonical("points", "5.0")),
    );
    expect(estimateValueKey(canonical("categories", "m"))).toBe(
      estimateValueKey(canonical("categories", "M")),
    );
    expect(estimateValueKey(canonical("categories", "Very  hard"))).toBe(
      estimateValueKey(canonical("categories", "very hard")),
    );
  });
});

describe("validateEstimateValues", () => {
  it("returns the canonical points in the given order", () => {
    expect(validateEstimateValues("points", ["8", "1", "2.50"])).toEqual({
      ok: true,
      points: [
        { value: "8", numericValue: 8 },
        { value: "1", numericValue: 1 },
        { value: "2.5", numericValue: 2.5 },
      ],
    });
  });

  it("reports every offending value by index", () => {
    expect(validateEstimateValues("points", ["1", "abc", "0", "2"])).toEqual({
      ok: false,
      errors: [
        { index: 1, code: "not_numeric" },
        { index: 2, code: "not_positive" },
      ],
    });
  });

  it("flags the later copy as the duplicate", () => {
    expect(validateEstimateValues("points", ["5", "3", "5.0"])).toEqual({
      ok: false,
      errors: [{ index: 2, code: "duplicate" }],
    });
    expect(validateEstimateValues("categories", ["m", "L", "M"])).toEqual({
      ok: false,
      errors: [{ index: 2, code: "duplicate" }],
    });
    expect(validateEstimateValues("time", ["60", "060"])).toEqual({
      ok: false,
      errors: [{ index: 1, code: "duplicate" }],
    });
  });

  it("applies the 2 to 10 count to the whole list with index -1", () => {
    expect(validateEstimateValues("points", ["1"])).toEqual({
      ok: false,
      errors: [{ index: -1, code: "too_few" }],
    });
    expect(validateEstimateValues("points", [])).toEqual({
      ok: false,
      errors: [{ index: -1, code: "too_few" }],
    });
    const eleven = Array.from({ length: 11 }, (_, i) => String(i + 1));
    expect(validateEstimateValues("points", eleven)).toEqual({
      ok: false,
      errors: [{ index: -1, code: "too_many" }],
    });
    const ten = eleven.slice(0, 10);
    expect(validateEstimateValues("points", ten).ok).toBe(true);
  });

  it("reports value errors and the count error together", () => {
    expect(validateEstimateValues("categories", ["3"])).toEqual({
      ok: false,
      errors: [
        { index: 0, code: "numeric_category" },
        { index: -1, code: "too_few" },
      ],
    });
  });
});

describe("validateEstimateValue", () => {
  const existing = [
    { value: "1", numericValue: 1 },
    { value: "2", numericValue: 2 },
  ];

  it("checks one value against the others with index 0", () => {
    expect(validateEstimateValue("points", "3", existing)).toEqual({
      ok: true,
      point: { value: "3", numericValue: 3 },
    });
    expect(validateEstimateValue("points", "2.0", existing)).toEqual({
      ok: false,
      error: { index: 0, code: "duplicate" },
    });
    expect(validateEstimateValue("points", "x", existing)).toEqual({
      ok: false,
      error: { index: 0, code: "not_numeric" },
    });
  });
});
