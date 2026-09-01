import { describe, expect, it } from "vitest";
import { finalStateOf } from "../../demo";
import { createAnalyticsScene } from "./analytics-scene";
import { analyticsReducer, initialAnalyticsState, totalOf } from "./state";

describe("analytics scene", () => {
  it("ends grouped by status with the bars grown and the menu closed", () => {
    expect(finalStateOf(createAnalyticsScene())).toEqual({
      xAxis: "status",
      menuOpen: false,
      grown: true,
    });
  });

  it("renders flat bars right after a new grouping, then grows them", () => {
    const open = analyticsReducer(initialAnalyticsState, { type: "openMenu" });
    const picked = analyticsReducer(open, { type: "select", xAxis: "label" });
    expect(picked).toEqual({ xAxis: "label", menuOpen: false, grown: false });
    expect(analyticsReducer(picked, { type: "grow" }).grown).toBe(true);
  });

  it("keeps the bars when the same grouping is picked again", () => {
    const open = analyticsReducer(initialAnalyticsState, { type: "openMenu" });
    const same = analyticsReducer(open, { type: "select", xAxis: "priority" });
    expect(same.grown).toBe(true);
    expect(same.menuOpen).toBe(false);
  });

  it("counts the same 46 tasks by status and by priority", () => {
    expect(totalOf("status")).toBe(46);
    expect(totalOf("priority")).toBe(46);
  });
});
