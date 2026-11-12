import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_WIDGETS,
  MAX_PINNED_REPORTS,
  moveWidget,
  normalizeHomeWidgets,
  pinnedReportIds,
  setWidgetEnabled,
  togglePinnedReport,
} from "./home-widgets";

describe("normalizeHomeWidgets", () => {
  it("returns the defaults for an empty or invalid list", () => {
    expect(normalizeHomeWidgets([])).toEqual(DEFAULT_HOME_WIDGETS);
    expect(normalizeHomeWidgets(null)).toEqual(DEFAULT_HOME_WIDGETS);
    expect(normalizeHomeWidgets("nope")).toEqual(DEFAULT_HOME_WIDGETS);
  });

  it("drops unknown keys, keeps the first duplicate and appends missing keys enabled", () => {
    expect(
      normalizeHomeWidgets([
        { key: "stickies", enabled: false },
        { key: "tour", enabled: true },
        { key: "stickies", enabled: true },
        null,
        { key: "recents", enabled: false },
      ]),
    ).toEqual([
      { key: "stickies", enabled: false },
      { key: "recents", enabled: false },
      { key: "quick-links", enabled: true },
      { key: "risks", enabled: true },
      { key: "my-brief", enabled: false },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: false },
    ]);
  });

  it("keeps opt-in widgets off until turned on", () => {
    expect(DEFAULT_HOME_WIDGETS.slice(-3)).toEqual([
      { key: "my-brief", enabled: false },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: false },
    ]);
    expect(
      normalizeHomeWidgets([{ key: "my-brief", enabled: true }])[0],
    ).toEqual({ key: "my-brief", enabled: true });
  });
});

describe("pinned reports", () => {
  it("is off for everyone until they pin something", () => {
    const widget = DEFAULT_HOME_WIDGETS.find(
      ({ key }) => key === "pinned-reports",
    );
    expect(widget).toEqual({ key: "pinned-reports", enabled: false });
    expect(pinnedReportIds(DEFAULT_HOME_WIDGETS)).toEqual([]);
  });

  it("keeps the pins from a stored list, on their widget only", () => {
    const widgets = normalizeHomeWidgets([
      { key: "recents", enabled: true, reportIds: ["x"] },
      { key: "pinned-reports", enabled: true, reportIds: ["a", 1, "b"] },
    ]);
    expect(widgets[0]).toEqual({ key: "recents", enabled: true });
    expect(pinnedReportIds(widgets)).toEqual(["a", "b"]);
  });

  it("turns the widget on with the first pin and off with the last", () => {
    const pinned = togglePinnedReport(DEFAULT_HOME_WIDGETS, "a", ["a"]);
    expect(pinned?.find(({ key }) => key === "pinned-reports")).toEqual({
      key: "pinned-reports",
      enabled: true,
      reportIds: ["a"],
    });

    const unpinned = togglePinnedReport(pinned ?? [], "a", ["a"]);
    expect(unpinned?.find(({ key }) => key === "pinned-reports")).toEqual({
      key: "pinned-reports",
      enabled: false,
    });
  });

  it("leaves the other widgets and their order alone", () => {
    const moved = moveWidget(DEFAULT_HOME_WIDGETS, "stickies", "quick-links");
    const pinned = togglePinnedReport(moved, "a", ["a"]);
    expect(pinned?.map(({ key }) => key)).toEqual(moved.map(({ key }) => key));
    expect(pinned?.slice(0, 5)).toEqual(moved.slice(0, 5));
  });

  it("refuses a pin over the limit, not counting pins that are gone", () => {
    const ids = Array.from(
      { length: MAX_PINNED_REPORTS },
      (_, index) => `r${index}`,
    );
    const full = normalizeHomeWidgets([
      { key: "pinned-reports", enabled: true, reportIds: ids },
    ]);
    expect(togglePinnedReport(full, "new", ids)).toBeNull();

    const withGone = togglePinnedReport(full, "new", ids.slice(1));
    expect(pinnedReportIds(withGone ?? [])).toEqual([...ids.slice(1), "new"]);
  });
});

describe("widget list edits", () => {
  it("toggles one widget and keeps the order", () => {
    expect(setWidgetEnabled(DEFAULT_HOME_WIDGETS, "recents", false)).toEqual([
      { key: "quick-links", enabled: true },
      { key: "recents", enabled: false },
      { key: "stickies", enabled: true },
      { key: "risks", enabled: true },
      { key: "my-brief", enabled: false },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: false },
    ]);
  });

  it("moves a widget onto another's slot", () => {
    expect(
      moveWidget(DEFAULT_HOME_WIDGETS, "stickies", "quick-links").map(
        (widget) => widget.key,
      ),
    ).toEqual([
      "stickies",
      "quick-links",
      "recents",
      "risks",
      "my-brief",
      "pinned-reports",
      "project-updates",
    ]);
    expect(
      moveWidget(DEFAULT_HOME_WIDGETS, "stickies", "unknown").map(
        (widget) => widget.key,
      ),
    ).toEqual([
      "quick-links",
      "recents",
      "stickies",
      "risks",
      "my-brief",
      "pinned-reports",
      "project-updates",
    ]);
  });
});
