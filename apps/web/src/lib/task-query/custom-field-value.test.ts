import { describe, expect, it } from "vitest";
import { formatDateShort } from "@/lib/format";
import {
  customFieldOptions,
  customFieldValueLabel,
} from "./custom-field-value";

const t = (key: string) => key;

describe("customFieldValueLabel", () => {
  it("reads booleans through their copy", () => {
    expect(customFieldValueLabel("boolean", "true", t)).toBe(
      "tasks:customFieldValue.true",
    );
    expect(customFieldValueLabel("boolean", "false", t)).toBe(
      "tasks:customFieldValue.false",
    );
    expect(customFieldValueLabel("boolean", "other", t)).toBe("other");
  });

  it("reads a date as its own day in any zone", () => {
    expect(customFieldValueLabel("date", "2026-03-01", t)).toBe(
      formatDateShort(new Date(2026, 2, 1)),
    );
  });

  it("leaves other values and empty ones as they are", () => {
    expect(customFieldValueLabel("number", "12.5", t)).toBe("12.5");
    expect(customFieldValueLabel("dropdown", "Beta", t)).toBe("Beta");
    expect(customFieldValueLabel(undefined, "x", t)).toBe("x");
    expect(customFieldValueLabel("date", "", t)).toBe("");
    expect(customFieldValueLabel("date", "soon", t)).toBe("soon");
  });
});

describe("customFieldOptions", () => {
  it("keeps only text options", () => {
    expect(customFieldOptions(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(customFieldOptions(null)).toEqual([]);
  });
});
