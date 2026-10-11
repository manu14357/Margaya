import { describe, expect, it } from "vitest";
import {
  addMonths,
  isValidDay,
  isValidTimeZone,
  presetRange,
  rollingRange,
  startOfWeek,
  startOfZonedDay,
  toInstantRange,
  zonedDay,
} from "../../../apps/api/src/task-query/dates";

function iso(day: string, timeZone: string) {
  return startOfZonedDay(day, timeZone).toISOString();
}

describe("startOfZonedDay", () => {
  it("is local midnight as a UTC instant", () => {
    expect(iso("2026-09-26", "UTC")).toBe("2026-09-26T00:00:00.000Z");
    expect(iso("2026-09-26", "America/Los_Angeles")).toBe(
      "2026-09-26T07:00:00.000Z",
    );
  });

  it("handles non-hour offsets", () => {
    expect(iso("2026-09-26", "Asia/Kolkata")).toBe("2026-09-25T18:30:00.000Z");
    expect(iso("2026-09-26", "Asia/Kathmandu")).toBe(
      "2026-09-25T18:15:00.000Z",
    );
  });

  it("gives 23 and 25 hour days across DST changes", () => {
    const zone = "America/Los_Angeles";
    const spring =
      startOfZonedDay("2026-03-09", zone).getTime() -
      startOfZonedDay("2026-03-08", zone).getTime();
    const autumn =
      startOfZonedDay("2026-11-02", zone).getTime() -
      startOfZonedDay("2026-11-01", zone).getTime();
    expect(spring / 3_600_000).toBe(23);
    expect(autumn / 3_600_000).toBe(25);
  });

  it("starts a day whose midnight is skipped at the transition", () => {
    // Clocks jump from 00:00 to 01:00 in both zones.
    expect(iso("2026-09-06", "America/Santiago")).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(iso("2026-03-08", "America/Havana")).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    for (const [day, zone] of [
      ["2026-09-06", "America/Santiago"],
      ["2026-03-08", "America/Havana"],
    ] as const) {
      const start = startOfZonedDay(day, zone);
      expect(zonedDay(start, zone)).toBe(day);
      expect(zonedDay(new Date(start.getTime() - 1), zone) < day).toBe(true);
    }
  });

  it("gives an empty range to a day the zone skipped", () => {
    expect(iso("2011-12-30", "Pacific/Apia")).toBe(
      iso("2011-12-31", "Pacific/Apia"),
    );
  });
});

describe("zonedDay", () => {
  it("reads the calendar day in the zone", () => {
    const instant = new Date("2026-09-26T20:00:00.000Z");
    expect(zonedDay(instant, "UTC")).toBe("2026-09-26");
    expect(zonedDay(instant, "Asia/Kolkata")).toBe("2026-09-27");
    expect(zonedDay(instant, "America/Los_Angeles")).toBe("2026-09-26");
  });
});

describe("isValidTimeZone and isValidDay", () => {
  it("accepts IANA zones and real calendar days only", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidDay("2026-02-28")).toBe(true);
    expect(isValidDay("2026-02-30")).toBe(false);
    expect(isValidDay("2026-2-3")).toBe(false);
  });
});

describe("month arithmetic", () => {
  it("clamps to the target month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2027-01-15", -1)).toBe("2026-12-15");
  });
});

describe("presetRange", () => {
  const saturday = "2026-09-26";

  it.each([
    [0, "2026-09-20", "2026-09-27"],
    [1, "2026-09-21", "2026-09-28"],
    [6, "2026-09-26", "2026-10-03"],
  ] as const)(
    "thisWeek with weeks starting on %i",
    (weekStart, from, until) => {
      expect(presetRange("thisWeek", saturday, weekStart)).toEqual({
        from,
        until,
      });
      expect(startOfWeek(saturday, weekStart)).toBe(from);
    },
  );

  it("covers the relative days, weeks and months", () => {
    expect(presetRange("today", saturday, 0)).toEqual({
      from: "2026-09-26",
      until: "2026-09-27",
    });
    expect(presetRange("yesterday", saturday, 0)).toEqual({
      from: "2026-09-25",
      until: "2026-09-26",
    });
    expect(presetRange("tomorrow", saturday, 0)).toEqual({
      from: "2026-09-27",
      until: "2026-09-28",
    });
    expect(presetRange("lastWeek", saturday, 1)).toEqual({
      from: "2026-09-14",
      until: "2026-09-21",
    });
    expect(presetRange("nextWeek", saturday, 1)).toEqual({
      from: "2026-09-28",
      until: "2026-10-05",
    });
    expect(presetRange("thisMonth", saturday, 0)).toEqual({
      from: "2026-09-01",
      until: "2026-10-01",
    });
    expect(presetRange("nextMonth", saturday, 0)).toEqual({
      from: "2026-10-01",
      until: "2026-11-01",
    });
    expect(presetRange("past", saturday, 0)).toEqual({
      from: null,
      until: "2026-09-26",
    });
    expect(presetRange("future", saturday, 0)).toEqual({
      from: "2026-09-27",
      until: null,
    });
    expect(presetRange("none", saturday, 0)).toBeNull();
  });

  it("crosses a year boundary for last month", () => {
    expect(presetRange("lastMonth", "2027-01-10", 0)).toEqual({
      from: "2026-12-01",
      until: "2027-01-01",
    });
  });
});

describe("rollingRange", () => {
  const today = "2026-09-26";

  it("keeps today inside the last and next windows", () => {
    expect(rollingRange("withinLast", 7, "days", today)).toEqual({
      from: "2026-09-20",
      until: "2026-09-27",
    });
    expect(rollingRange("withinNext", 7, "days", today)).toEqual({
      from: "2026-09-26",
      until: "2026-10-03",
    });
  });

  it("leaves the boundary day out of the more-than windows", () => {
    expect(rollingRange("moreThanAgo", 2, "weeks", today)).toEqual({
      from: null,
      until: "2026-09-12",
    });
    expect(rollingRange("moreThanAhead", 1, "months", today)).toEqual({
      from: "2026-10-27",
      until: null,
    });
  });

  it("adds calendar months, clamped", () => {
    expect(rollingRange("withinNext", 1, "months", "2026-01-31")).toEqual({
      from: "2026-01-31",
      until: "2026-02-28",
    });
  });
});

describe("toInstantRange", () => {
  it("turns day bounds into zoned instants", () => {
    const range = toInstantRange(
      { from: "2026-09-26", until: "2026-09-27" },
      "Asia/Kolkata",
    );
    expect(range.gte?.toISOString()).toBe("2026-09-25T18:30:00.000Z");
    expect(range.lt?.toISOString()).toBe("2026-09-26T18:30:00.000Z");
    expect(toInstantRange({ from: null, until: null }, "UTC")).toEqual({
      gte: null,
      lt: null,
    });
  });
});
