import { describe, expect, it } from "vitest";
import {
  buildFieldEdit,
  defaultAfterEdit,
  hasDuplicateOptions,
  type OptionRow,
  optionsAreValid,
  rowsFromOptions,
} from "./custom-field-edit";

const row = (original: string | null, value: string): OptionRow => ({
  key: value,
  original,
  value,
});

describe("buildFieldEdit", () => {
  it("sends no renames when nothing changed", () => {
    expect(buildFieldEdit(rowsFromOptions(["A", "B"]))).toEqual({
      options: ["A", "B"],
    });
  });

  it("treats a changed row as a rename, not a removal", () => {
    expect(buildFieldEdit([row("A", " A2 "), row("B", "B")])).toEqual({
      options: ["A2", "B"],
      renamedOptions: [{ from: "A", to: "A2" }],
    });
  });

  it("removes a deleted row and adds a new one without renames", () => {
    expect(buildFieldEdit([row("A", "A"), row(null, "C")])).toEqual({
      options: ["A", "C"],
    });
  });
});

describe("option validation", () => {
  it("needs at least one filled, distinct option", () => {
    expect(optionsAreValid([])).toBe(false);
    expect(optionsAreValid([row(null, " ")])).toBe(false);
    expect(optionsAreValid([row(null, "A"), row(null, " A ")])).toBe(false);
    expect(optionsAreValid([row(null, "A"), row("B", "B")])).toBe(true);
  });

  it("flags only real duplicates", () => {
    expect(hasDuplicateOptions([row(null, ""), row(null, "")])).toBe(false);
    expect(hasDuplicateOptions([row(null, "A"), row(null, "A")])).toBe(true);
  });
});

describe("defaultAfterEdit", () => {
  it("follows a rename and drops a removed option", () => {
    expect(defaultAfterEdit([row("A", "A2")], "A")).toBe("A2");
    expect(defaultAfterEdit([row("B", "B")], "A")).toBe("");
    expect(defaultAfterEdit([row("B", "B")], "")).toBe("");
  });
});
