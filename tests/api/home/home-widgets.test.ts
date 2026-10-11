import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_WIDGETS,
  listsEveryWidgetOnce,
  normalizeHomeWidgets,
  sameWidgetList,
} from "../../../apps/api/src/home/widgets";

describe("home widgets", () => {
  it("defaults to every widget on, in catalog order", () => {
    expect(DEFAULT_HOME_WIDGETS).toEqual([
      { key: "quick-links", enabled: true },
      { key: "recents", enabled: true },
      { key: "stickies", enabled: true },
    ]);
    expect(normalizeHomeWidgets([])).toEqual(DEFAULT_HOME_WIDGETS);
    expect(normalizeHomeWidgets(null)).toEqual(DEFAULT_HOME_WIDGETS);
  });

  it("drops unknown keys, keeps the first duplicate and appends missing keys", () => {
    expect(
      normalizeHomeWidgets([
        { key: "stickies", enabled: false },
        { key: "tour", enabled: true },
        { key: "stickies", enabled: true },
        "junk",
        null,
        { key: "recents", enabled: false },
      ]),
    ).toEqual([
      { key: "stickies", enabled: false },
      { key: "recents", enabled: false },
      { key: "quick-links", enabled: true },
    ]);
  });

  it("requires every widget exactly once", () => {
    expect(
      listsEveryWidgetOnce([
        { key: "recents" },
        { key: "stickies" },
        { key: "quick-links" },
      ]),
    ).toBe(true);
    expect(
      listsEveryWidgetOnce([{ key: "recents" }, { key: "stickies" }]),
    ).toBe(false);
    expect(
      listsEveryWidgetOnce([
        { key: "recents" },
        { key: "recents" },
        { key: "stickies" },
      ]),
    ).toBe(false);
    expect(
      listsEveryWidgetOnce([
        { key: "recents" },
        { key: "stickies" },
        { key: "quick-links" },
        { key: "tour" },
      ]),
    ).toBe(false);
  });

  it("compares lists by order and state", () => {
    const list = normalizeHomeWidgets([]);
    expect(sameWidgetList(list, [...DEFAULT_HOME_WIDGETS])).toBe(true);
    expect(sameWidgetList(list, [...list].reverse())).toBe(false);
    expect(
      sameWidgetList(
        list,
        list.map((widget, index) => ({ ...widget, enabled: index !== 0 })),
      ),
    ).toBe(false);
  });
});
