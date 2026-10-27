import { describe, expect, it } from "vitest";
import { recurrenceSummary, weekdayNames } from "./recurrence";

// Echoes the key and options, so the tests check what reaches i18next.
const t = (key: string, options?: Record<string, unknown>) =>
  `${key}${options ? ` ${JSON.stringify(options)}` : ""}`;

describe("recurrenceSummary", () => {
  it("names the chosen weekdays in order, in the UI language", () => {
    expect(weekdayNames("en-US")[0]).toBe("Sun");
    const summary = recurrenceSummary(
      { frequency: "weekly", interval: 2, weekdays: [3, 1] },
      t,
      "en-US",
    );
    expect(summary).toBe(
      'tasks:recurrence.summary.weekly {"count":2,"days":"Mon, Wed"}',
    );
  });

  it("falls back to the anchor's weekday and day of the month", () => {
    expect(
      recurrenceSummary(
        { frequency: "weekly", interval: 1, anchorDate: "2026-10-20" },
        t,
        "en-US",
      ),
    ).toContain('"days":"Tue"');
    expect(
      recurrenceSummary(
        { frequency: "monthly", interval: 1, anchorDate: "2026-10-20" },
        t,
        "en-US",
      ),
    ).toContain('"day":20');
  });

  it("adds the end date or the count", () => {
    expect(
      recurrenceSummary(
        { frequency: "daily", interval: 1, endDate: "2026-12-31" },
        t,
        "en-US",
      ),
    ).toMatch(/^tasks:recurrence\.summary\.until .*Dec 31, 2026/);
    expect(
      recurrenceSummary(
        { frequency: "daily", interval: 1, maxOccurrences: 5 },
        t,
        "en-US",
      ),
    ).toMatch(/^tasks:recurrence\.summary\.times .*"count":5/);
  });
});
