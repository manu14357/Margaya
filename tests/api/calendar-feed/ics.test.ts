import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  foldLine,
  formatDate,
  formatUtcDateTime,
  type IcsEvent,
} from "../../../apps/api/src/calendar-feed/ics";

const octets = (value: string) => Buffer.byteLength(value, "utf8");
const unfold = (value: string) => value.replace(/\r\n /g, "");

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "task-t1@margaya",
    startDate: "2026-11-15",
    endDate: "2026-11-16",
    summary: "Ship it",
    lastModified: new Date("2026-11-13T10:15:30.123Z"),
    sequence: 7,
    ...overrides,
  };
}

describe("escapeText", () => {
  it("escapes backslashes, semicolons, commas and line breaks", () => {
    expect(escapeText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
    expect(escapeText("one\ntwo\r\nthree\rfour")).toBe(
      "one\\ntwo\\nthree\\nfour",
    );
  });

  it("escapes the backslash before adding its own", () => {
    expect(escapeText("\\n")).toBe("\\\\n");
  });

  it("drops control characters but keeps tabs", () => {
    expect(escapeText("a\u0000b\u0007c\u007fd\te")).toBe("abcd\te");
  });

  it("leaves colons and non-ASCII text alone", () => {
    expect(escapeText("Fix: Zürich 東京 ✓")).toBe("Fix: Zürich 東京 ✓");
  });
});

describe("foldLine", () => {
  it("keeps a line of exactly 75 octets whole", () => {
    const line = "x".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("folds at 75 octets with CRLF and one leading space", () => {
    const line = "x".repeat(76);
    expect(foldLine(line)).toBe(`${"x".repeat(75)}\r\n x`);
  });

  it("keeps every physical line within 75 octets, space included", () => {
    const folded = foldLine(`SUMMARY:${"abcdefghij".repeat(40)}`);
    for (const physical of folded.split("\r\n")) {
      expect(octets(physical)).toBeLessThanOrEqual(75);
    }
    expect(unfold(folded)).toBe(`SUMMARY:${"abcdefghij".repeat(40)}`);
  });

  it("counts UTF-8 bytes and never splits a character", () => {
    const line = `SUMMARY:${"é東😀a".repeat(30)}`;
    const folded = foldLine(line);
    const physicalLines = folded.split("\r\n");
    expect(physicalLines.length).toBeGreaterThan(1);
    for (const [index, physical] of physicalLines.entries()) {
      expect(octets(physical)).toBeLessThanOrEqual(75);
      if (index > 0) expect(physical.startsWith(" ")).toBe(true);
      // A split surrogate pair or byte sequence would not round-trip.
      expect(Buffer.from(physical, "utf8").toString("utf8")).toBe(physical);
      expect(physical).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe("value formats", () => {
  it("writes DATE and UTC DATE-TIME values", () => {
    expect(formatDate("2026-01-05")).toBe("20260105");
    expect(formatUtcDateTime(new Date("2026-11-13T10:15:30.999Z"))).toBe(
      "20261113T101530Z",
    );
  });
});

describe("buildCalendar", () => {
  const ics = buildCalendar({
    name: "My tasks, Studio; North",
    timezone: "Asia/Kolkata",
    events: [
      event({
        description: "WEB-1 · Website\nhttps://margaya.test/x",
        url: "https://margaya.test/x",
        categories: ["Web, site"],
      }),
    ],
  });

  it("ends every line in CRLF, with no bare LF or CR", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("wraps events in a VCALENDAR with the required properties", () => {
    const lines = unfold(ics).split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//Margaya//Calendar feed//EN");
    expect(lines).toContain("X-WR-CALNAME:My tasks\\, Studio\\; North");
    expect(lines).toContain("X-WR-TIMEZONE:Asia/Kolkata");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("writes an all-day event with a stable UID, SEQUENCE and LAST-MODIFIED", () => {
    const lines = unfold(ics).split("\r\n");
    expect(lines).toContain("UID:task-t1@margaya");
    expect(lines).toContain("DTSTART;VALUE=DATE:20261115");
    expect(lines).toContain("DTEND;VALUE=DATE:20261116");
    expect(lines).toContain("SEQUENCE:7");
    expect(lines).toContain("LAST-MODIFIED:20261113T101530Z");
    expect(lines).toContain("DTSTAMP:20261113T101530Z");
    expect(lines).toContain("URL:https://margaya.test/x");
    expect(lines).toContain(
      "DESCRIPTION:WEB-1 · Website\\nhttps://margaya.test/x",
    );
    expect(lines).toContain("CATEGORIES:Web\\, site");
    expect(lines).toContain("TRANSP:TRANSPARENT");
  });

  it("is identical for identical input, so ETags stay stable", () => {
    const again = buildCalendar({
      name: "My tasks, Studio; North",
      timezone: "Asia/Kolkata",
      events: [
        event({
          description: "WEB-1 · Website\nhttps://margaya.test/x",
          url: "https://margaya.test/x",
          categories: ["Web, site"],
        }),
      ],
    });
    expect(again).toBe(ics);
  });

  it("strips line breaks from URLs instead of letting them start a property", () => {
    const injected = buildCalendar({
      name: "x",
      timezone: "UTC",
      events: [event({ url: "https://a.test/\r\nATTACH:evil" })],
    });
    expect(unfold(injected)).toContain("URL:https://a.test/ATTACH:evil\r\n");
    expect(unfold(injected)).not.toContain("\r\nATTACH:");
  });

  it("keeps a multi-line, comma-laden summary on one logical line", () => {
    const tricky = buildCalendar({
      name: "x",
      timezone: "UTC",
      events: [event({ summary: "Line 1\r\nEND:VEVENT\r\nBEGIN:VEVENT" })],
    });
    expect(unfold(tricky)).toContain(
      "SUMMARY:Line 1\\nEND:VEVENT\\nBEGIN:VEVENT\r\n",
    );
    expect(unfold(tricky).match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
  });
});
