import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { formCustomFieldValues, looksAutomated, publicFormPath } = await import(
  "../../../apps/api/src/intake-form/service"
);

describe("spam guard", () => {
  it("drops honeypot and too-fast submissions", () => {
    expect(looksAutomated({ title: "x", website: "http://spam" })).toBe(true);
    expect(looksAutomated({ title: "x", elapsedMs: 300 })).toBe(true);
    expect(looksAutomated({ title: "x", website: " ", elapsedMs: 5_000 })).toBe(
      false,
    );
    expect(looksAutomated({ title: "x" })).toBe(false);
  });
});

describe("custom field values", () => {
  const fields = [
    {
      id: "f1",
      name: "Team",
      type: "dropdown" as const,
      options: ["Web", "Ops"],
      required: true,
    },
    {
      id: "f2",
      name: "Budget",
      type: "number" as const,
      options: null,
      required: false,
    },
    {
      id: "f3",
      name: "Notes",
      type: "text" as const,
      options: null,
      required: false,
    },
  ];

  it("keeps valid values of the form's fields only", () => {
    expect(
      formCustomFieldValues(fields, {
        f1: " Ops ",
        f2: "12.5",
        f3: "",
        other: "ignored",
      }),
    ).toEqual([
      { fieldId: "f1", value: "Ops" },
      { fieldId: "f2", value: "12.5" },
    ]);
  });

  it("refuses missing required and invalid values", () => {
    expect(() => formCustomFieldValues(fields, {})).toThrow("Team is required");
    expect(() => formCustomFieldValues(fields, { f1: "Sales" })).toThrow();
    expect(() =>
      formCustomFieldValues(fields, { f1: "Web", f2: "lots" }),
    ).toThrow();
    expect(() =>
      formCustomFieldValues(fields, { f1: "Web", f3: "x".repeat(1_001) }),
    ).toThrow();
  });

  it("builds the public path", () => {
    expect(publicFormPath("tok")).toBe("/request-form/tok");
  });
});
