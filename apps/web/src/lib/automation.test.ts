import { describe, expect, it } from "vitest";
import {
  AUTOMATION_MONTH_OPTIONS,
  cancelledColumns,
  isBroaderChange,
  previewLine,
} from "./automation";

describe("AUTOMATION_MONTH_OPTIONS", () => {
  it("offers 1 to 12 months", () => {
    expect(AUTOMATION_MONTH_OPTIONS).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});

describe("isBroaderChange", () => {
  const off = { enabled: false, months: 3 };
  const on = { enabled: true, months: 3 };

  it("is broader when a rule turns on", () => {
    expect(isBroaderChange(off, on)).toBe(true);
  });

  it("is broader with fewer months", () => {
    expect(isBroaderChange(on, { enabled: true, months: 2 })).toBe(true);
  });

  it("is not broader when turning off, with more months or the same", () => {
    expect(isBroaderChange(on, off)).toBe(false);
    expect(isBroaderChange(on, { enabled: true, months: 6 })).toBe(false);
    expect(isBroaderChange(on, on)).toBe(false);
    expect(isBroaderChange(off, { enabled: false, months: 1 })).toBe(false);
  });
});

describe("cancelledColumns", () => {
  it("keeps the Cancelled group, by position", () => {
    const columns = [
      { id: "a", slug: "done", group: "completed", position: 0 },
      { id: "b", slug: "wont", group: "cancelled", position: 3 },
      { id: "c", slug: "dup", group: "cancelled", position: 1 },
      { id: "d", slug: "todo", group: "unstarted", position: 2 },
    ];
    expect(cancelledColumns(columns).map((column) => column.id)).toEqual([
      "c",
      "b",
    ]);
  });
});

describe("previewLine", () => {
  it("covers loading, none, a count and the cap", () => {
    expect(previewLine(undefined).key).toBe(
      "settings:projectAutomations.preview.loading",
    );
    expect(previewLine({ count: 0, capped: false }).key).toBe(
      "settings:projectAutomations.preview.none",
    );
    expect(previewLine({ count: 4, capped: false })).toEqual({
      key: "settings:projectAutomations.preview.count",
      options: { count: 4 },
    });
    expect(previewLine({ count: 10_000, capped: true }).key).toBe(
      "settings:projectAutomations.preview.capped",
    );
  });
});
