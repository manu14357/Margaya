import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatNumber, formatRelativeTime } from "./format";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("format helpers", () => {
  it("format like a fresh Intl formatter for each locale and options", () => {
    const day = new Date("2026-08-10T12:00:00Z");
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    };
    expect(formatDate(day, options, "en-US")).toBe(
      new Intl.DateTimeFormat("en-US", options).format(day),
    );
    expect(formatDate(day, options, "de-DE")).toBe(
      new Intl.DateTimeFormat("de-DE", options).format(day),
    );
    expect(formatDate(day, { year: "numeric", timeZone: "UTC" }, "en-US")).toBe(
      "2026",
    );
    expect(formatNumber(1234.567, undefined, "en-US")).toBe("1,234.57");
    expect(
      formatRelativeTime(
        new Date("2026-08-09T12:00:00Z"),
        "en-US",
        new Date("2026-08-10T12:00:00Z"),
      ),
    ).toBe("yesterday");
  });

  it("reads a timestamp a few seconds ahead of this clock as now", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    const ahead = (ms: number) => new Date(now.getTime() + ms);
    expect(formatRelativeTime(ahead(1_000), "en-US", now)).toBe("now");
    expect(formatRelativeTime(ahead(9_000), "en-US", now)).toBe("now");
    // Real future times still read as such.
    expect(formatRelativeTime(ahead(5 * 60_000), "en-US", now)).toBe(
      "in 5 minutes",
    );
    expect(formatRelativeTime(ahead(-30_000), "en-US", now)).toBe(
      "30 seconds ago",
    );
  });

  it("builds one date formatter per locale and options, not one per call", () => {
    let constructed = 0;
    const Original = Intl.DateTimeFormat;
    class Counting extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args);
        constructed++;
      }
    }
    vi.stubGlobal(
      "Intl",
      Object.assign(Object.create(Intl), { DateTimeFormat: Counting }),
    );
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      timeZone: "UTC",
    };
    const labels = new Set<string>();
    for (let day = 1; day <= 50; day++) {
      labels.add(
        formatDate(new Date(Date.UTC(2026, 0, day)), options, "fr-FR"),
      );
    }
    expect(constructed).toBe(1);
    expect(labels.size).toBe(7);
  });
});
