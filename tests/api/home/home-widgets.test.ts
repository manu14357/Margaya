import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_WIDGETS,
  listsEveryWidgetOnce,
  MAX_PINNED_REPORTS,
  normalizeHomeWidgets,
  sameWidgetList,
} from "../../../apps/api/src/home/widgets";

describe("home widgets", () => {
  it("defaults to every widget on except opt-in ones, in catalog order", () => {
    expect(DEFAULT_HOME_WIDGETS).toEqual([
      { key: "quick-links", enabled: true },
      { key: "recents", enabled: true },
      { key: "stickies", enabled: true },
      { key: "risks", enabled: true },
      { key: "my-brief", enabled: false },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: false },
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
      { key: "risks", enabled: true },
      { key: "my-brief", enabled: false },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: false },
    ]);
  });

  it("keeps an opt-in widget the person turned on", () => {
    expect(
      normalizeHomeWidgets([{ key: "my-brief", enabled: true }])[0],
    ).toEqual({ key: "my-brief", enabled: true });
  });

  it("requires every widget exactly once", () => {
    expect(
      listsEveryWidgetOnce([
        { key: "recents" },
        { key: "stickies" },
        { key: "quick-links" },
        { key: "risks" },
        { key: "my-brief" },
        { key: "pinned-reports" },
        { key: "project-updates" },
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
        { key: "risks" },
        { key: "my-brief" },
        { key: "pinned-reports" },
        { key: "project-updates" },
        { key: "tour" },
      ]),
    ).toBe(false);
  });

  it("keeps pinned reports on their widget only, unique and capped", () => {
    const ids = Array.from(
      { length: MAX_PINNED_REPORTS + 2 },
      (_, index) => `report-${index}`,
    );
    const widgets = normalizeHomeWidgets([
      { key: "recents", enabled: true, reportIds: ["report-x"] },
      {
        key: "pinned-reports",
        enabled: true,
        reportIds: ["report-0", 7, "", "report-0", ...ids],
      },
    ]);
    expect(widgets[0]).toEqual({ key: "recents", enabled: true });
    expect(widgets[1]).toEqual({
      key: "pinned-reports",
      enabled: true,
      reportIds: ids.slice(0, MAX_PINNED_REPORTS),
    });
    // No pins: the field stays out, so stored lists keep their shape.
    expect(
      normalizeHomeWidgets([
        { key: "pinned-reports", enabled: true, reportIds: [] },
      ])[0],
    ).toEqual({ key: "pinned-reports", enabled: true });
  });

  it("treats a change of pinned reports as a change", () => {
    const pinned = normalizeHomeWidgets([
      { key: "pinned-reports", enabled: true, reportIds: ["a", "b"] },
    ]);
    const same = normalizeHomeWidgets([
      { key: "pinned-reports", enabled: true, reportIds: ["a", "b"] },
    ]);
    const reordered = normalizeHomeWidgets([
      { key: "pinned-reports", enabled: true, reportIds: ["b", "a"] },
    ]);
    expect(sameWidgetList(pinned, same)).toBe(true);
    expect(sameWidgetList(pinned, reordered)).toBe(false);
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
