import { describe, expect, it } from "vitest";
import {
  parseJiraDate,
  resolveTimeZone,
} from "../../../apps/api/src/jira-import/dates";

const iso = (raw: string, zone?: string) =>
  parseJiraDate(raw, zone)?.date.toISOString() ?? null;

describe("Jira date parsing", () => {
  it.each([
    ["12/Mar/24 3:45 PM", "2024-03-12T15:45:00.000Z"],
    ["12/Mar/24 12:05 AM", "2024-03-12T00:05:00.000Z"],
    ["12/Mar/24 12:05 PM", "2024-03-12T12:05:00.000Z"],
    ["1/Jan/2025 9:00 am", "2025-01-01T09:00:00.000Z"],
    ["05/Sep/23 17:30", "2023-09-05T17:30:00.000Z"],
    ["05-September-2023", "2023-09-05T00:00:00.000Z"],
    ["2024-03-12", "2024-03-12T00:00:00.000Z"],
    ["2024-03-12 08:15", "2024-03-12T08:15:00.000Z"],
    ["2024-03-12T15:45:00.000+0000", "2024-03-12T15:45:00.000Z"],
    ["2024-03-12T15:45:00+02:00", "2024-03-12T13:45:00.000Z"],
  ])("reads %s", (raw, expected) => {
    expect(iso(raw)).toBe(expected);
  });

  it.each([
    "",
    "not a date",
    "31/Feb/24",
    "12/Foo/24 3:45 PM",
    "12/Mar/24 25:00",
    "2024-13-01",
  ])("rejects %j", (raw) => {
    expect(parseJiraDate(raw)).toBeNull();
  });

  it("flags calendar days", () => {
    expect(parseJiraDate("12/Mar/24")?.dateOnly).toBe(true);
    expect(parseJiraDate("12/Mar/24 3:45 PM")?.dateOnly).toBe(false);
  });

  it("reads wall-clock times in the importer's time zone, across DST", () => {
    // Berlin is UTC+1 in winter and UTC+2 in summer.
    expect(iso("15/Jan/24 10:00 AM", "Europe/Berlin")).toBe(
      "2024-01-15T09:00:00.000Z",
    );
    expect(iso("15/Jul/24 10:00 AM", "Europe/Berlin")).toBe(
      "2024-07-15T08:00:00.000Z",
    );
    expect(iso("15/Jul/24", "America/New_York")).toBe(
      "2024-07-15T04:00:00.000Z",
    );
    // An explicit offset wins over the zone.
    expect(iso("2024-07-15T10:00:00Z", "Europe/Berlin")).toBe(
      "2024-07-15T10:00:00.000Z",
    );
  });

  it("falls back to UTC for unknown zones", () => {
    expect(resolveTimeZone("Mars/Olympus")).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});
