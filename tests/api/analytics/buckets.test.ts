import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  bucketCount,
  bucketEnd,
  bucketStart,
  fillDateKeys,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  rangeBuckets,
  TOO_MANY_BUCKETS,
} from "../../../apps/api/src/analytics/buckets";

function message(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(400);
    return (error as HTTPException).message;
  }
}

// 2026-03-01 is a Sunday.
const WEEK = [
  "2026-03-01",
  "2026-03-02",
  "2026-03-03",
  "2026-03-04",
  "2026-03-05",
  "2026-03-06",
  "2026-03-07",
];

describe("bucketStart", () => {
  it("starts weeks on Sunday", () => {
    for (const day of WEEK) {
      expect(bucketStart(day, "week", 0)).toBe("2026-03-01");
    }
  });

  it("starts weeks on Monday", () => {
    expect(bucketStart("2026-03-01", "week", 1)).toBe("2026-02-23");
    for (const day of WEEK.slice(1)) {
      expect(bucketStart(day, "week", 1)).toBe("2026-03-02");
    }
  });

  it("starts weeks on Saturday", () => {
    for (const day of WEEK.slice(0, 6)) {
      expect(bucketStart(day, "week", 6)).toBe("2026-02-28");
    }
    expect(bucketStart("2026-03-07", "week", 6)).toBe("2026-03-07");
  });

  it("starts months on the first", () => {
    expect(bucketStart("2026-03-31", "month", 0)).toBe("2026-03-01");
    expect(bucketStart("2026-01-01", "month", 1)).toBe("2026-01-01");
  });

  it("handles the leap day", () => {
    // Tuesday 2028-02-29.
    expect(bucketStart("2028-02-29", "week", 1)).toBe("2028-02-28");
    expect(bucketStart("2028-02-29", "month", 0)).toBe("2028-02-01");
    expect(bucketEnd("2028-02-01", "month")).toBe("2028-02-29");
    expect(bucketEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(bucketEnd("2026-02-23", "week")).toBe("2026-03-01");
  });
});

describe("rangeBuckets", () => {
  it("clips the first and last weeks to the range", () => {
    expect(rangeBuckets("2026-03-01", "2026-03-31", "week", 1)).toEqual([
      { start: "2026-02-23", rangeStart: "2026-03-01", rangeEnd: "2026-03-01" },
      { start: "2026-03-02", rangeStart: "2026-03-02", rangeEnd: "2026-03-08" },
      { start: "2026-03-09", rangeStart: "2026-03-09", rangeEnd: "2026-03-15" },
      { start: "2026-03-16", rangeStart: "2026-03-16", rangeEnd: "2026-03-22" },
      { start: "2026-03-23", rangeStart: "2026-03-23", rangeEnd: "2026-03-29" },
      { start: "2026-03-30", rangeStart: "2026-03-30", rangeEnd: "2026-03-31" },
    ]);
  });

  it("clips months, across a year boundary", () => {
    expect(rangeBuckets("2025-12-15", "2026-02-10", "month", 0)).toEqual([
      { start: "2025-12-01", rangeStart: "2025-12-15", rangeEnd: "2025-12-31" },
      { start: "2026-01-01", rangeStart: "2026-01-01", rangeEnd: "2026-01-31" },
      { start: "2026-02-01", rangeStart: "2026-02-01", rangeEnd: "2026-02-10" },
    ]);
  });

  it("returns one bucket for a single day", () => {
    expect(rangeBuckets("2028-02-29", "2028-02-29", "month", 0)).toEqual([
      { start: "2028-02-01", rangeStart: "2028-02-29", rangeEnd: "2028-02-29" },
    ]);
  });

  it("refuses bad dates and ranges", () => {
    expect(
      message(() => rangeBuckets("2026-02-30", "2026-03-01", "week", 0)),
    ).toBe(INVALID_DATE);
    expect(
      message(() => rangeBuckets("2026-3-1", "2026-03-01", "week", 0)),
    ).toBe(INVALID_DATE);
    expect(
      message(() => rangeBuckets("2026-03-02", "2026-03-01", "week", 0)),
    ).toBe(INVALID_DATE_RANGE);
  });

  it("allows 106 weeks and 60 months, not more", () => {
    // Sunday 2024-01-07 plus 105 weeks.
    expect(rangeBuckets("2024-01-07", "2026-01-11", "week", 0)).toHaveLength(
      106,
    );
    expect(
      message(() => rangeBuckets("2024-01-07", "2026-01-18", "week", 0)),
    ).toBe(TOO_MANY_BUCKETS);
    expect(rangeBuckets("2021-01-01", "2025-12-31", "month", 0)).toHaveLength(
      60,
    );
    expect(
      message(() => rangeBuckets("2021-01-01", "2026-01-01", "month", 0)),
    ).toBe(TOO_MANY_BUCKETS);
    // More than five years is refused whatever the bucket.
    expect(
      message(() => rangeBuckets("2020-01-01", "2025-01-06", "month", 0)),
    ).toBe(TOO_MANY_BUCKETS);
  });
});

describe("fillDateKeys", () => {
  it("fills every bucket between the first and last key", () => {
    expect(fillDateKeys(["2026-03-23", "2026-03-09"], "week", 120)).toEqual({
      keys: ["2026-03-09", "2026-03-16", "2026-03-23"],
      hidden: 0,
    });
    expect(fillDateKeys(["2025-11-01", "2026-01-01"], "month", 120)).toEqual({
      keys: ["2025-11-01", "2025-12-01", "2026-01-01"],
      hidden: 0,
    });
    expect(fillDateKeys([], "week", 120)).toEqual({ keys: [], hidden: 0 });
  });

  it("keeps the most recent buckets under the cap", () => {
    const filled = fillDateKeys(["2015-01-01", "2025-10-01"], "month", 120);
    expect(filled.hidden).toBe(10);
    expect(filled.keys).toHaveLength(120);
    expect(filled.keys[0]).toBe("2015-11-01");
    expect(filled.keys.at(-1)).toBe("2025-10-01");
  });

  it("stays cheap for huge spans", () => {
    const filled = fillDateKeys(["0001-01-01", "9999-12-01"], "month", 120);
    expect(filled.keys).toHaveLength(120);
    expect(filled.hidden).toBe(
      bucketCount("0001-01-01", "9999-12-01", "month") - 120,
    );
  });
});
