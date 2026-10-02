import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_WIDGETS,
  moveWidget,
  normalizeHomeWidgets,
  setWidgetEnabled,
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
    ]);
  });
});

describe("widget list edits", () => {
  it("toggles one widget and keeps the order", () => {
    expect(setWidgetEnabled(DEFAULT_HOME_WIDGETS, "recents", false)).toEqual([
      { key: "quick-links", enabled: true },
      { key: "recents", enabled: false },
      { key: "stickies", enabled: true },
    ]);
  });

  it("moves a widget onto another's slot", () => {
    expect(
      moveWidget(DEFAULT_HOME_WIDGETS, "stickies", "quick-links").map(
        (widget) => widget.key,
      ),
    ).toEqual(["stickies", "quick-links", "recents"]);
    expect(
      moveWidget(DEFAULT_HOME_WIDGETS, "stickies", "unknown").map(
        (widget) => widget.key,
      ),
    ).toEqual(["quick-links", "recents", "stickies"]);
  });
});
