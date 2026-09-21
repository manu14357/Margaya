import { describe, expect, it } from "vitest";
import {
  detectDateOrder,
  parseImportDate,
  resolveDateOrder,
} from "./csv-dates";

// Calendar days are local midnight, so assert the local day.
function localDay(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe("parseImportDate", () => {
  it("reads ISO calendar days as local midnight", () => {
    const iso = parseImportDate("2026-03-04", null);
    expect(localDay(iso)).toEqual([2026, 3, 4]);
    expect(new Date(iso ?? "").getHours()).toBe(0);
    expect(localDay(parseImportDate("2026/3/9", null))).toEqual([2026, 3, 9]);
  });

  it("keeps ISO date-times as instants", () => {
    expect(parseImportDate("2026-03-04T10:30:00.000Z", null)).toBe(
      "2026-03-04T10:30:00.000Z",
    );
  });

  it("reads slash dates in the given order", () => {
    expect(localDay(parseImportDate("03/04/2026", "mdy"))).toEqual([
      2026, 3, 4,
    ]);
    expect(localDay(parseImportDate("03/04/2026", "dmy"))).toEqual([
      2026, 4, 3,
    ]);
  });

  it("reads only self-evident slash dates without an order", () => {
    expect(localDay(parseImportDate("13/04/2026", null))).toEqual([
      2026, 4, 13,
    ]);
    expect(localDay(parseImportDate("04/13/2026", null))).toEqual([
      2026, 4, 13,
    ]);
    expect(parseImportDate("03/04/2026", null)).toBeNull();
  });

  it("rejects days that don't exist and other text", () => {
    expect(parseImportDate("2026-02-30", null)).toBeNull();
    expect(parseImportDate("31/04/2026", "dmy")).toBeNull();
    expect(parseImportDate("13/13/2026", "mdy")).toBeNull();
    expect(parseImportDate("next week", null)).toBeNull();
    expect(parseImportDate("  ", null)).toBeNull();
  });
});

describe("detectDateOrder", () => {
  it("detects day-first and month-first files", () => {
    expect(detectDateOrder(["03/04/2026", "25/04/2026"])).toBe("dmy");
    expect(detectDateOrder(["03/04/2026", "04/25/2026"])).toBe("mdy");
  });

  it("is null when nothing or everything disambiguates", () => {
    expect(detectDateOrder(["03/04/2026", "2026-01-01", ""])).toBeNull();
    expect(detectDateOrder(["25/04/2026", "04/25/2026"])).toBeNull();
  });

  it("uses a fixed format as given", () => {
    expect(resolveDateOrder("dmy", ["04/25/2026"])).toBe("dmy");
    expect(resolveDateOrder("auto", ["04/25/2026"])).toBe("mdy");
  });
});
